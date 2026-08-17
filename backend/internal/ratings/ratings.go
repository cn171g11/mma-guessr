package ratings

import (
	"database/sql"
	"errors"
	"math"

	"mma-guessr/backend/internal/util"
)

// Season identifies the current ladder season. Bump it when a new season
// starts; stale rows are kept for history but never ranked.
const Season = "2026-S1"

// Ladder constants. BaseK scales rating movement, maxGameScore is the best
// possible single-game total (10 rounds x 5000), and rating is clamped to the
// [minRating, maxRating] band to keep the ladder stable.
const (
	baseK        = 25
	maxGameScore = 50000
	minRating    = 100
	maxRating    = 3000
)

// Tier is one ladder band with its lower rating bound.
type Tier struct {
	MinRating int
	Name      string
}

// Tiers lists all bands, ascending. TierFor picks the highest satisfied band.
var Tiers = []Tier{
	{MinRating: 0, Name: "青铜"},
	{MinRating: 1100, Name: "白银"},
	{MinRating: 1300, Name: "黄金"},
	{MinRating: 1500, Name: "铂金"},
	{MinRating: 1800, Name: "钻石"},
	{MinRating: 2100, Name: "大师"},
	{MinRating: 2500, Name: "宗师"},
}

// View is the client-facing rating snapshot.
type View struct {
	Season      string  `json:"season"`
	Rating      int     `json:"rating"`
	Tier        int     `json:"tier"`
	TierName    string  `json:"tierName"`
	NextTier    *string `json:"nextTier,omitempty"`
	GamesPlayed int     `json:"gamesPlayed"`
	Wins        int     `json:"wins"`
	BestStreak  int     `json:"bestStreak"`
}

// Entry is one row of the ladder leaderboard.
type Entry struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Rating   int    `json:"rating"`
	Tier     int    `json:"tier"`
	TierName string `json:"tierName"`
	Wins     int    `json:"wins"`
}

// Service tracks the seasonal rating ladder and duel win streaks.
type Service struct {
	conn *sql.DB
}

// NewService creates a ratings Service.
func NewService(conn *sql.DB) *Service {
	return &Service{conn: conn}
}

// TierFor returns the 1-based band index and name for a rating.
func TierFor(rating int) (int, string) {
	idx := 0
	for i, t := range Tiers {
		if rating >= t.MinRating {
			idx = i
		}
	}
	return idx + 1, Tiers[idx].Name
}

// NextTierName returns the name of the next band above rating, or nil.
func NextTierName(rating int) *string {
	for _, t := range Tiers {
		if rating < t.MinRating {
			name := t.Name
			return &name
		}
	}
	return nil
}

// RatingDelta computes the rating change for a single-player game. A perfect
// game gains +baseK, a zero-score game loses -baseK, scaling linearly.
func RatingDelta(totalScore int) int {
	if totalScore < 0 {
		totalScore = 0
	}
	if totalScore > maxGameScore {
		totalScore = maxGameScore
	}
	ratio := float64(totalScore) / float64(maxGameScore)
	delta := int(math.Round(float64(baseK) * (2*ratio - 1)))
	if delta == 0 {
		return 1 // reward any positive progress so beginners climb
	}
	return delta
}

func clampRating(v int) int {
	if v < minRating {
		return minRating
	}
	if v > maxRating {
		return maxRating
	}
	return v
}

// ApplyGame records a completed user game and moves the rating. Duel games go
// through the same path (score-based), while win streaks are tracked
// separately by RecordDuel.
func (s *Service) ApplyGame(userID string, totalScore int) error {
	tx, err := s.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() // #nosec G307 -- rollback after commit is a no-op

	var rating int
	err = tx.QueryRow(`SELECT rating FROM season_ratings WHERE user_id = ?`, userID).Scan(&rating)
	if errors.Is(err, sql.ErrNoRows) {
		rating = 1000
		err = nil
	}
	if err != nil {
		return err
	}

	delta := RatingDelta(totalScore)
	newRating := clampRating(rating + delta)
	tier, _ := TierFor(newRating)
	win := 0
	if delta > 0 {
		win = 1
	}

	_, err = tx.Exec(`
		INSERT INTO season_ratings (user_id, season, rating, tier, games_played, wins, updated_at)
		VALUES (?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			rating = ?, tier = ?, games_played = games_played + 1, wins = wins + ?, updated_at = ?
	`, userID, Season, newRating, tier, win, util.Now(),
		newRating, tier, win, util.Now())
	if err != nil {
		return err
	}
	return tx.Commit()
}

// RecordDuel updates the win/loss streak after a duel finishes. Winning
// increments the streak, losing resets it. Only registered users have streaks.
func (s *Service) RecordDuel(userID string, won bool) error {
	delta := 1
	if !won {
		delta = 0
	}
	_, err := s.conn.Exec(`
		INSERT INTO user_streaks (user_id, current_streak, best_streak, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
			best_streak = MAX(best_streak, CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END),
			updated_at = ?
	`,
		userID, delta, delta, util.Now(),
		delta, delta, util.Now())
	return err
}

// Get returns the current rating snapshot for a user. Unknown users get the
// neutral starting row.
func (s *Service) Get(userID string) (*View, error) {
	var (
		season      string
		rating      int
		tier        int
		gamesPlayed int
		wins        int
		bestStreak  int
	)
	err := s.conn.QueryRow(`
		SELECT sr.season, sr.rating, sr.tier, sr.games_played, sr.wins,
		       COALESCE(us.best_streak, 0)
		FROM season_ratings sr
		LEFT JOIN user_streaks us ON us.user_id = sr.user_id
		WHERE sr.user_id = ?
	`, userID).Scan(&season, &rating, &tier, &gamesPlayed, &wins, &bestStreak)
	if errors.Is(err, sql.ErrNoRows) {
		rating = 1000
		tier = 1
		season = Season
	} else if err != nil {
		return nil, err
	}
	tierName := "青铜"
	if idx := tier - 1; idx >= 0 && idx < len(Tiers) {
		tierName = Tiers[idx].Name
	}
	return &View{
		Season:      season,
		Rating:      rating,
		Tier:        tier,
		TierName:    tierName,
		NextTier:    NextTierName(rating),
		GamesPlayed: gamesPlayed,
		Wins:        wins,
		BestStreak:  bestStreak,
	}, nil
}

// Leaderboard returns the top N rated users for the current season.
func (s *Service) Leaderboard(limit int) ([]Entry, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.conn.Query(`
		SELECT sr.user_id, u.username, sr.rating, sr.tier, sr.wins
		FROM season_ratings sr
		JOIN users u ON u.id = sr.user_id
		WHERE sr.season = ?
		ORDER BY sr.rating DESC, sr.wins DESC
		LIMIT ?
	`, Season, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]Entry, 0, limit)
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Username, &e.Rating, &e.Tier, &e.Wins); err != nil {
			return nil, err
		}
		_, e.TierName = TierFor(e.Rating)
		entries = append(entries, e)
	}
	return entries, rows.Err()
}