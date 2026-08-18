package leaderboard

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"sync"
	"time"

	"mma-guessr/backend/internal/util"
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

const (
	// overallDateKey is the date_key used for the all-time board.
	overallDateKey = ""
	// dailyRetentionDays is how many daily boards are kept before pruning.
	dailyRetentionDays = 7
	// usernameCacheTTL bounds how long a resolved username is reused before
	// the users table is consulted again.
	usernameCacheTTL = 5 * time.Minute
)

// Service maintains the per-mode best-score leaderboards. Ranks live in the
// leaderboard_best table: RecordScore upserts one row per board (O(log n))
// instead of the previous full-list rewrite, and reads are a single indexed
// ORDER BY LIMIT query.
type Service struct {
	conn      *sql.DB
	usernames *usernameCache
}

// NewService creates a leaderboard Service.
func NewService(conn *sql.DB) *Service {
	return &Service{conn: conn, usernames: newUsernameCache(usernameCacheTTL)}
}

// rankedPlayer is a cached-in-memory best-score row awaiting username lookup.
type rankedPlayer struct {
	id    string
	score int
}

// RecordScore persists one game score and upserts the best-score rows for the
// overall and today's daily boards.
func (s *Service) RecordScore(userID, mode string, score int) error {
	if _, err := s.conn.Exec(
		`INSERT INTO scores (player_type, player_id, mode, score, created_at) VALUES ('user', ?, ?, ?, ?)`,
		userID, mode, score, time.Now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	today := util.UTCDate()
	if err := s.upsertBest(mode, overallDateKey, userID, score); err != nil {
		return err
	}
	return s.upsertBest(mode, today, userID, score)
}

// upsertBest records the score only when it improves the player's best. The
// single-connection SQLite pool serializes writes, so the guarded UPSERT is
// race-free.
func (s *Service) upsertBest(mode, dateKey, userID string, score int) error {
	_, err := s.conn.Exec(
		`INSERT INTO leaderboard_best (mode, date_key, player_id, best_score, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(mode, date_key, player_id) DO UPDATE SET
		   best_score = MAX(best_score, excluded.best_score),
		   updated_at = excluded.updated_at`,
		mode, dateKey, userID, score, time.Now().UTC().Format(time.RFC3339))
	return err
}

// GetRankings returns the top entries for the board.
func (s *Service) GetRankings(query Query) ([]Entry, error) {
	dateKey := overallDateKey
	if query.Period == "daily" {
		if query.Date != nil {
			dateKey = *query.Date
		} else {
			dateKey = util.UTCDate()
		}
	}
	limit := query.Limit
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.conn.Query(
		`SELECT player_id, best_score FROM leaderboard_best
		 WHERE mode = ? AND date_key = ?
		 ORDER BY best_score DESC, player_id DESC
		 LIMIT ?`,
		query.Mode, dateKey, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	players := make([]rankedPlayer, 0, limit)
	for rows.Next() {
		var id string
		var score int
		if err := rows.Scan(&id, &score); err != nil {
			return nil, err
		}
		players = append(players, rankedPlayer{id: id, score: score})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(players) == 0 {
		return []Entry{}, nil
	}

	usernames := s.fetchUsernames(players)
	out := make([]Entry, 0, len(players))
	for _, player := range players {
		username, ok := usernames[player.id]
		if !ok {
			username = "未知玩家"
		}
		out = append(out, Entry{ID: player.id, Username: username, Score: player.score})
	}
	return out, nil
}

// fetchUsernames resolves usernames for ranked players, serving cache hits
// from memory and batching DB lookups only for misses.
func (s *Service) fetchUsernames(players []rankedPlayer) map[string]string {
	names := make(map[string]string, len(players))
	missing := make([]string, 0, len(players))
	for _, player := range players {
		if name, ok := s.usernames.Get(player.id); ok {
			names[player.id] = name
			continue
		}
		missing = append(missing, player.id)
	}
	if len(missing) == 0 {
		return names
	}

	placeholders := strings.Repeat("?,", len(missing))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, 0, len(missing))
	for _, id := range missing {
		args = append(args, id)
	}
	rows, err := s.conn.Query(`SELECT id, username FROM users WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return names
	}
	defer rows.Close()
	for rows.Next() {
		var id, username string
		if err := rows.Scan(&id, &username); err != nil {
			break
		}
		names[id] = username
		s.usernames.Set(id, username)
	}
	return names
}

// StartNightlyRebuild recomputes the overall and recent daily boards at every
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

// Rebuild recomputes leaderboard_best from the authoritative scores table and
// prunes daily rows outside the retention window. INSERT OR IGNORE leaves any
// higher live upserts untouched, so the rebuild is idempotent and safe to run
// nightly, on demand, or after a database restore.
func (s *Service) Rebuild() error {
	if err := s.backfillFromScores(); err != nil {
		return err
	}
	return s.pruneStaleDailyRows()
}

// backfillFromScores inserts best-score rows missing from leaderboard_best.
func (s *Service) backfillFromScores() error {
	if _, err := s.conn.Exec(
		`INSERT OR IGNORE INTO leaderboard_best (mode, date_key, player_id, best_score, updated_at)
		 SELECT mode, '', player_id, MAX(score), MAX(created_at) FROM scores
		 WHERE player_type = 'user' GROUP BY mode, player_id`); err != nil {
		return err
	}
	boundary := time.Now().UTC().AddDate(0, 0, -dailyRetentionDays).Format("2006-01-02")
	if _, err := s.conn.Exec(
		`INSERT OR IGNORE INTO leaderboard_best (mode, date_key, player_id, best_score, updated_at)
		 SELECT mode, substr(created_at, 1, 10), player_id, MAX(score), MAX(created_at) FROM scores
		 WHERE player_type = 'user' AND substr(created_at, 1, 10) >= ?
		 GROUP BY mode, substr(created_at, 1, 10), player_id`, boundary); err != nil {
		return err
	}
	return nil
}

// pruneStaleDailyRows drops daily boards older than the retention window.
func (s *Service) pruneStaleDailyRows() error {
	boundary := time.Now().UTC().AddDate(0, 0, -dailyRetentionDays).Format("2006-01-02")
	_, err := s.conn.Exec(
		`DELETE FROM leaderboard_best WHERE date_key <> '' AND date_key < ?`, boundary)
	return err
}

// usernameCache is a small in-process TTL cache mapping player IDs to
// usernames. It removes one DB round-trip per ranked player per board read.
type usernameCache struct {
	mu   sync.Mutex
	ttl  time.Duration
	byID map[string]usernameEntry
}

type usernameEntry struct {
	name string
	exp  time.Time
}

// newUsernameCache creates an empty username cache.
func newUsernameCache(ttl time.Duration) *usernameCache {
	return &usernameCache{ttl: ttl, byID: make(map[string]usernameEntry)}
}

// Get returns a fresh cached username, evicting expired entries.
func (c *usernameCache) Get(playerID string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.byID[playerID]
	if !ok {
		return "", false
	}
	if time.Now().After(entry.exp) {
		delete(c.byID, playerID)
		return "", false
	}
	return entry.name, true
}

// Set caches a username, pruning expired entries when the map grows large.
func (c *usernameCache) Set(playerID, name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.byID) >= 4096 {
		now := time.Now()
		for id, entry := range c.byID {
			if now.After(entry.exp) {
				delete(c.byID, id)
			}
		}
	}
	c.byID[playerID] = usernameEntry{name: name, exp: time.Now().Add(c.ttl)}
}
