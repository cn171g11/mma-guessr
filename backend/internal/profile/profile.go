package profile

import (
	"database/sql"
	"encoding/json"
	"math"

	"mma-guessr/backend/internal/kv"
)

// ModeStats summarizes one mode's performance.
type ModeStats struct {
	Games     int     `json:"games"`
	Rounds    int     `json:"rounds"`
	BestScore int     `json:"bestScore"`
	AvgScore  float64 `json:"avgScore"`
}

// Aggregation is the player's career statistics snapshot.
type Aggregation struct {
	TotalGames     int                  `json:"totalGames"`
	TotalRounds    int                  `json:"totalRounds"`
	TotalScore     int                  `json:"totalScore"`
	AvgScore       float64              `json:"avgScore"`
	BestScore      int                  `json:"bestScore"`
	BestMode       *string              `json:"bestMode"`
	CorrectGuesses int                  `json:"correctGuesses"`
	Accuracy       float64              `json:"accuracy"`
	ByMode         map[string]ModeStats `json:"byMode"`
}

// Profile is the resolved player profile payload.
type Profile struct {
	Username string      `json:"username"`
	Role     string      `json:"role"`
	Stats    Aggregation `json:"stats"`
}

// Service aggregates game statistics with a short TTL cache.
type Service struct {
	conn *sql.DB
	kv   *kv.Store
}

// NewService creates a profile Service.
func NewService(conn *sql.DB, cache *kv.Store) *Service {
	return &Service{conn: conn, kv: cache}
}

func statsCacheKey(role, id string) string {
	return "profile:stats:" + role + ":" + id
}

// InvalidateStatsCache drops the cached aggregation after a new game.
func (s *Service) InvalidateStatsCache(role, id string) {
	_ = s.kv.Del(statsCacheKey(role, id))
}

// GetAggregation returns the player's stats, cached for 5 minutes.
func (s *Service) GetAggregation(role, id string) (*Aggregation, error) {
	key := statsCacheKey(role, id)
	if cached, ok := s.kv.Get(key); ok {
		var stats Aggregation
		if err := json.Unmarshal([]byte(cached), &stats); err == nil {
			return &stats, nil
		}
	}
	stats, err := s.fetchAggregation(role, id)
	if err != nil {
		return nil, err
	}
	if raw, err := json.Marshal(stats); err == nil {
		_ = s.kv.Set(key, string(raw), 5*60)
	}
	return stats, nil
}

func (s *Service) fetchAggregation(role, id string) (*Aggregation, error) {
	var totalGames, totalRounds, totalScore, bestScore int
	var avgScore float64
	err := s.conn.QueryRow(
		`SELECT COUNT(*),
		        COALESCE(SUM(json_array_length(rounds)), 0),
		        COALESCE(SUM(total_score), 0),
		        COALESCE(AVG(total_score), 0),
		        COALESCE(MAX(total_score), 0)
		 FROM game_results WHERE player_type = ? AND player_id = ?`,
		role, id).Scan(&totalGames, &totalRounds, &totalScore, &avgScore, &bestScore)
	if err != nil {
		return nil, err
	}
	avgScore = round1(avgScore)

	var correctGuesses int
	err = s.conn.QueryRow(
		`SELECT COUNT(*) FROM game_results
		 CROSS JOIN json_each(rounds)
		 WHERE player_type = ? AND player_id = ? AND CAST(json_extract(value, '$.score') AS INTEGER) > 0`,
		role, id).Scan(&correctGuesses)
	if err != nil {
		return nil, err
	}

	var bestMode *string
	row := s.conn.QueryRow(
		`SELECT mode FROM game_results
		 WHERE player_type = ? AND player_id = ?
		 ORDER BY total_score DESC, id DESC LIMIT 1`,
		role, id)
	var mode sql.NullString
	if err := row.Scan(&mode); err == nil && mode.Valid {
		bestMode = &mode.String
	}

	rows, err := s.conn.Query(
		`SELECT mode,
		        COUNT(*),
		        COALESCE(SUM(json_array_length(rounds)), 0),
		        COALESCE(MAX(total_score), 0),
		        COALESCE(AVG(total_score), 0)
		 FROM game_results WHERE player_type = ? AND player_id = ?
		 GROUP BY mode`,
		role, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byMode := map[string]ModeStats{}
	for rows.Next() {
		var mode string
		var games, rounds, best int
		var avg float64
		if err := rows.Scan(&mode, &games, &rounds, &best, &avg); err != nil {
			return nil, err
		}
		byMode[mode] = ModeStats{Games: games, Rounds: rounds, BestScore: best, AvgScore: round1(avg)}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	accuracy := 0.0
	if totalRounds > 0 {
		accuracy = round1(float64(correctGuesses) / float64(totalRounds) * 100)
	}
	return &Aggregation{
		TotalGames:     totalGames,
		TotalRounds:    totalRounds,
		TotalScore:     totalScore,
		AvgScore:       avgScore,
		BestScore:      bestScore,
		BestMode:       bestMode,
		CorrectGuesses: correctGuesses,
		Accuracy:       accuracy,
		ByMode:         byMode,
	}, nil
}

func round1(value float64) float64 {
	return math.Round(value*10) / 10
}

// CollectionItem is one positively-identified location in the player's atlas.
type CollectionItem struct {
	Name      string `json:"name"`
	Count     int    `json:"count"`
	FirstSeen string `json:"firstSeen"`
	LastSeen  string `json:"lastSeen"`
}

// Collections returns the distinct locations the player has positively
// identified (score > 0), most recently seen first.
func (s *Service) Collections(role, id string) ([]CollectionItem, error) {
	rows, err := s.conn.Query(`
		SELECT json_extract(value, '$.name') AS name,
		       COUNT(*) AS cnt,
		       MIN(g.created_at),
		       MAX(g.created_at)
		FROM game_results g CROSS JOIN json_each(g.rounds)
		WHERE g.player_type = ? AND g.player_id = ?
		  AND CAST(json_extract(value, '$.score') AS INTEGER) > 0
		  AND json_extract(value, '$.name') IS NOT NULL
		  AND json_extract(value, '$.name') != ''
		GROUP BY json_extract(value, '$.name')
		ORDER BY MAX(g.created_at) DESC
	`, role, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CollectionItem, 0, 16)
	for rows.Next() {
		var item CollectionItem
		if err := rows.Scan(&item.Name, &item.Count, &item.FirstSeen, &item.LastSeen); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
