package leaderboard

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"sort"
	"time"

	"mma-guessr/backend/internal/kv"
)

// Periods are the supported leaderboard windows.
var Periods = []string{"daily", "overall"}

// Entry is one ranked player.
type Entry struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Score    int    `json:"score"`
}

// Query selects a leaderboard slice.
type Query struct {
	Period string
	Mode   string
	Limit  int
	Date   *string
}

// Service maintains the per-mode best-score leaderboards.
type Service struct {
	conn *sql.DB
	kv   *kv.Store
}

// NewService creates a leaderboard Service.
func NewService(conn *sql.DB, cache *kv.Store) *Service {
	return &Service{conn: conn, kv: cache}
}

const (
	overallPrefix   = "lb:overall:"
	dailyPrefix     = "lb:daily:"
	rebuildLockKey  = "lb:rebuild-lock"
	rebuildLockTTL  = 60
	overallCacheTTL = 30 * 24 * 60 * 60
	dailyCacheTTL   = 8 * 24 * 60 * 60
	retentionDays   = 7
)

func overallKey(mode string) string {
	return overallPrefix + mode
}

func dailyKey(mode, yyyymmdd string) string {
	return dailyPrefix + mode + ":" + yyyymmdd
}

func utcDateKey(now time.Time) string {
	return now.UTC().Format("20060102")
}

type cachedEntry struct {
	ID    string `json:"id"`
	Score int    `json:"score"`
}

// RecordScore persists one game score and updates the overall/daily caches
// (best-score semantics, mirroring the previous ZSET GT updates).
func (s *Service) RecordScore(userID, mode string, score int) error {
	_, err := s.conn.Exec(
		`INSERT INTO scores (player_type, player_id, mode, score, created_at) VALUES ('user', ?, ?, ?, ?)`,
		userID, mode, score, time.Now().UTC().Format("2006-01-02T15:04:05Z"))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_ = s.upsertBestCache(overallKey(mode), userID, score)
	_ = s.upsertBestCache(dailyKey(mode, now.Format("20060102")), userID, score)
	return nil
}

func (s *Service) upsertBestCache(key, userID string, score int) error {
	entries, ok := s.readCache(key)
	if !ok {
		// Missing cache is rebuilt lazily by GetRankings.
		return nil
	}
	updated := false
	for i := range entries {
		if entries[i].ID == userID {
			if score > entries[i].Score {
				entries[i].Score = score
				updated = true
			}
			break
		}
	}
	if !updated {
		entries = append(entries, cachedEntry{ID: userID, Score: score})
	}
	entries = normalizeEntries(entries)
	return s.writeCache(key, entries, overallCacheTTL)
}

// GetRankings returns the top entries, rebuilding the cache lazily for the
// overall and today's daily boards.
func (s *Service) GetRankings(query Query) ([]Entry, error) {
	today := utcDateKey(time.Now())
	dateKey := today
	if query.Date != nil {
		dateKey = (*query.Date)[0:4] + (*query.Date)[5:7] + (*query.Date)[8:10]
	}
	isOverall := query.Period == "overall"
	key := overallKey(query.Mode)
	if !isOverall {
		key = dailyKey(query.Mode, dateKey)
	}

	entries, ok := s.readCache(key)
	if !ok {
		if isOverall || dateKey == today {
			if acquired, err := s.kv.SetNX(rebuildLockKey, "1", rebuildLockTTL); err == nil && acquired {
				_ = s.Rebuild()
				_ = s.kv.Del(rebuildLockKey)
				entries, _ = s.readCache(key)
			}
		}
	}
	if len(entries) == 0 {
		// Historical daily boards are not rebuilt on demand.
		return []Entry{}, nil
	}

	usernames, err := s.fetchUsernames(entries)
	if err != nil {
		return nil, err
	}
	limit := query.Limit
	if limit > len(entries) {
		limit = len(entries)
	}
	out := make([]Entry, 0, limit)
	for _, entry := range entries[:limit] {
		username, ok := usernames[entry.ID]
		if !ok {
			username = "未知玩家"
		}
		out = append(out, Entry{ID: entry.ID, Username: username, Score: entry.Score})
	}
	return out, nil
}

// StartNightlyRebuild recomputes the overall and today's daily caches at every
// UTC midnight, mirroring the previous backend's scheduleNightlyRebuild. The
// goroutine stops when ctx is cancelled.
func (s *Service) StartNightlyRebuild(ctx context.Context, logger *slog.Logger) {
	go s.nightlyRebuildLoop(ctx, logger)
}

// nightlyRebuildLoop runs the rebuild once per UTC day until the context ends.
func (s *Service) nightlyRebuildLoop(ctx context.Context, logger *slog.Logger) {
	for {
		timer := time.NewTimer(time.Until(nextMidnightUTC(time.Now())))
		select {
		case <-timer.C:
			if err := s.Rebuild(); err != nil {
				logger.Error("nightly leaderboard rebuild failed", "error", err)
				continue
			}
			logger.Info("nightly leaderboard rebuild completed")
		case <-ctx.Done():
			timer.Stop()
			return
		}
	}
}

// nextMidnightUTC returns the upcoming UTC midnight boundary after now, so the
// rebuild aligns with the UTC day rollover that defines the daily board.
func nextMidnightUTC(now time.Time) time.Time {
	utc := now.UTC()
	midnight := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
	return midnight.AddDate(0, 0, 1)
}

// Rebuild recomputes overall and today's daily caches from the scores table
// and prunes stale daily keys beyond the retention window.
func (s *Service) Rebuild() error {
	today := utcDateKey(time.Now())
	overallRows, err := s.fetchBestScores("")
	if err != nil {
		return err
	}
	dailyRows, err := s.fetchBestScores(today)
	if err != nil {
		return err
	}

	byOverall := map[string][]cachedEntry{}
	for _, row := range overallRows {
		byOverall[row.mode] = append(byOverall[row.mode], cachedEntry{ID: row.userID, Score: row.score})
	}
	byDaily := map[string][]cachedEntry{}
	for _, row := range dailyRows {
		byDaily[row.mode] = append(byDaily[row.mode], cachedEntry{ID: row.userID, Score: row.score})
	}
	for mode, list := range byOverall {
		if err := s.writeCache(overallKey(mode), normalizeEntries(list), overallCacheTTL); err != nil {
			return err
		}
	}
	for mode, list := range byDaily {
		if err := s.writeCache(dailyKey(mode, today), normalizeEntries(list), dailyCacheTTL); err != nil {
			return err
		}
	}
	return s.pruneStaleDailyKeys()
}

type scoreRow struct {
	userID string
	mode   string
	score  int
}

func (s *Service) fetchBestScores(dateKey string) ([]scoreRow, error) {
	var rows *sql.Rows
	var err error
	if dateKey == "" {
		rows, err = s.conn.Query(
			`SELECT player_id, mode, MAX(score) AS score FROM scores GROUP BY player_id, mode`)
	} else {
		rows, err = s.conn.Query(
			`SELECT player_id, mode, MAX(score) AS score FROM scores
			 WHERE substr(created_at, 1, 10) = ? GROUP BY player_id, mode`,
			dateKey[:4]+"-"+dateKey[4:6]+"-"+dateKey[6:8])
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []scoreRow
	for rows.Next() {
		var row scoreRow
		if err := rows.Scan(&row.userID, &row.mode, &row.score); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Service) fetchUsernames(entries []cachedEntry) (map[string]string, error) {
	if len(entries) == 0 {
		return map[string]string{}, nil
	}
	placeholders := ""
	args := make([]any, 0, len(entries))
	for i, entry := range entries {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, entry.ID)
	}
	rows, err := s.conn.Query(
		`SELECT id, username FROM users WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	usernames := make(map[string]string, len(entries))
	for rows.Next() {
		var id, username string
		if err := rows.Scan(&id, &username); err != nil {
			return nil, err
		}
		usernames[id] = username
	}
	return usernames, rows.Err()
}

// normalizeEntries sorts by score desc, then id desc (mirroring Redis
// ZREVRANGE tie-breaking).
func normalizeEntries(entries []cachedEntry) []cachedEntry {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Score != entries[j].Score {
			return entries[i].Score > entries[j].Score
		}
		return entries[i].ID > entries[j].ID
	})
	return entries
}

func (s *Service) readCache(key string) ([]cachedEntry, bool) {
	raw, ok := s.kv.Get(key)
	if !ok {
		return nil, false
	}
	var entries []cachedEntry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, false
	}
	return entries, true
}

func (s *Service) writeCache(key string, entries []cachedEntry, ttl int) error {
	raw, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	return s.kv.Set(key, string(raw), ttl)
}

func (s *Service) pruneStaleDailyKeys() error {
	boundary := utcDateKey(time.Now().AddDate(0, 0, -retentionDays))
	// Scan the cache table for lb:daily: keys and drop stale ones.
	rows, err := s.conn.Query(`SELECT key FROM mapillary_cache WHERE key LIKE 'lb:daily:%'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var stale []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return err
		}
		datePart := key[len(dailyPrefix):]
		// key format: <mode>:<yyyymmdd>
		if len(datePart) >= 8 {
			datePart = datePart[len(datePart)-8:]
			if datePart < boundary {
				stale = append(stale, key)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, key := range stale {
		_ = s.kv.Del(key)
	}
	return nil
}
