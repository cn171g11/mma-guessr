package auth

import (
	"database/sql"
	"errors"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

// GuestSession is a temporary anonymous profile stored server-side.
type GuestSession struct {
	GuestID   string `json:"guestId"`
	Username  string `json:"username"`
	CreatedAt string `json:"createdAt"`
}

// Progress is the aggregate snapshot of a player's game history.
type Progress struct {
	TotalRounds    int `json:"totalRounds"`
	TotalScore     int `json:"totalScore"`
	BestScore      int `json:"bestScore"`
	CorrectGuesses int `json:"correctGuesses"`
}

// CreateGuest creates a guest session with a generated username and empty
// progress, expiring after guestTTLSeconds.
func (s *Store) CreateGuest(guestTTLSeconds int) (*GuestSession, error) {
	guestID := util.NewUUID()
	username := buildGuestUsername(guestID)
	now := util.Now()
	expiresAt := addSeconds(now, guestTTLSeconds)

	tx, err := s.conn.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT INTO guest_sessions (guest_id, username, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		guestID, username, now, expiresAt); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(
		`INSERT INTO guest_progress (guest_id, total_rounds, total_score, best_score, correct_guesses) VALUES (?, 0, 0, 0, 0)`,
		guestID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &GuestSession{GuestID: guestID, Username: username, CreatedAt: now}, nil
}

// GetGuest fetches a guest session, or nil when absent/expired.
func (s *Store) GetGuest(guestID string) (*GuestSession, error) {
	var g GuestSession
	var expiresAt string
	err := s.conn.QueryRow(
		`SELECT guest_id, username, created_at, expires_at FROM guest_sessions WHERE guest_id = ?`,
		guestID).Scan(&g.GuestID, &g.Username, &g.CreatedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if isExpired(expiresAt) {
		return nil, nil
	}
	return &g, nil
}

// GetGuestProgress returns the guest's progress snapshot.
func (s *Store) GetGuestProgress(guestID string) (*Progress, error) {
	return s.getProgress("guest_progress", "guest_id", guestID)
}

// GetUserProgress returns a registered user's progress snapshot.
func (s *Store) GetUserProgress(userID string) (*Progress, error) {
	return s.getProgress("user_progress", "user_id", userID)
}

func (s *Store) getProgress(table, idCol, id string) (*Progress, error) {
	var p Progress
	err := s.conn.QueryRow(
		`SELECT total_rounds, total_score, best_score, correct_guesses FROM `+table+` WHERE `+idCol+` = ?`,
		id).Scan(&p.TotalRounds, &p.TotalScore, &p.BestScore, &p.CorrectGuesses)
	if errors.Is(err, sql.ErrNoRows) {
		return &Progress{}, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// MergeGuestProgressIntoUser adds a guest's progress to a user account and
// deletes the guest session. Returns an HttpError if the guest is missing.
func (s *Store) MergeGuestProgressIntoUser(guestID, userID string) error {
	guest, err := s.GetGuest(guestID)
	if err != nil || guest == nil {
		if guest == nil {
			return httputil.BadRequest("游客会话不存在或已过期")
		}
		return err
	}

	guestProgress, err := s.GetGuestProgress(guestID)
	if err != nil {
		return err
	}

	tx, err := s.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Ensure the user has a progress row.
	if _, err := tx.Exec(
		`INSERT INTO user_progress (user_id, total_rounds, total_score, best_score, correct_guesses)
		 VALUES (?, 0, 0, 0, 0) ON CONFLICT(user_id) DO NOTHING`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE user_progress SET
			total_rounds = total_rounds + ?,
			total_score = total_score + ?,
			best_score = MAX(best_score, ?),
			correct_guesses = correct_guesses + ?
		 WHERE user_id = ?`,
		guestProgress.TotalRounds, guestProgress.TotalScore, guestProgress.BestScore,
		guestProgress.CorrectGuesses, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM guest_sessions WHERE guest_id = ?`, guestID); err != nil {
		return err
	}
	return tx.Commit()
}

// EnsureUserProgress ensures a progress row exists for a registered user.
func (s *Store) EnsureUserProgress(userID string) error {
	_, err := s.conn.Exec(
		`INSERT INTO user_progress (user_id, total_rounds, total_score, best_score, correct_guesses)
		 VALUES (?, 0, 0, 0, 0) ON CONFLICT(user_id) DO NOTHING`, userID)
	return err
}

// GetProgress returns the progress snapshot for a guest or user identity.
func (s *Store) GetProgress(role, playerID string) (*Progress, error) {
	if role == "guest" {
		return s.GetGuestProgress(playerID)
	}
	return s.GetUserProgress(playerID)
}

// UpsertProgress replaces the progress snapshot (absolute values, matching
// the previous upsert semantics where the service computes the new totals).
func (s *Store) UpsertProgress(role, playerID string, p Progress) error {
	table := "user_progress"
	idCol := "user_id"
	if role == "guest" {
		table = "guest_progress"
		idCol = "guest_id"
	}
	_, err := s.conn.Exec(
		`INSERT INTO `+table+` (`+idCol+`, total_rounds, total_score, best_score, correct_guesses)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(`+idCol+`) DO UPDATE SET
			total_rounds = excluded.total_rounds,
			total_score = excluded.total_score,
			best_score = excluded.best_score,
			correct_guesses = excluded.correct_guesses`,
		playerID, p.TotalRounds, p.TotalScore, p.BestScore, p.CorrectGuesses)
	return err
}

func buildGuestUsername(guestID string) string {
	return "游客_" + guestID[:4]
}

func addSeconds(now string, seconds int) string {
	return util.NowRFC3339Add(seconds)
}

func isExpired(expiresAt string) bool {
	return util.ParseTime(expiresAt).Before(util.NowTime())
}
