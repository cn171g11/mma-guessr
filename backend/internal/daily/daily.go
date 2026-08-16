package daily

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/util"
)

// PublicDailyLocation is what the frontend may see: never the answer coords.
type PublicDailyLocation struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Difficulty  int     `json:"difficulty"`
	Region      string  `json:"region"`
	MapillaryID *string `json:"mapillaryId"`
	PanoramaURL *string `json:"panoramaUrl"`
}

// DailyChallenge is today's challenge payload.
type DailyChallenge struct {
	Date      string                `json:"date"`
	Locations []PublicDailyLocation `json:"locations"`
	Played    bool                  `json:"played"`
}

// ChallengeRounds is the number of rounds in a daily challenge.
const ChallengeRounds = 10

// Service manages the daily challenge lifecycle.
type Service struct {
	conn      *sql.DB
	locations *locations.Store
}

// NewService creates a daily Service.
func NewService(conn *sql.DB, locations *locations.Store) *Service {
	return &Service{conn: conn, locations: locations}
}

// UTCDateString returns today's UTC date as YYYY-MM-DD.
func UTCDateString() string {
	return time.Now().UTC().Format("2006-01-02")
}

// resolveTodayIDs lazily draws and persists today's challenge set.
func (s *Service) resolveTodayIDs() ([]int64, error) {
	date := UTCDateString()
	existing, err := s.fetchTodayIDs(date)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	drawn, err := s.locations.GetRandomLocations(locations.RandomLocationsQuery{Count: ChallengeRounds})
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(drawn))
	for _, record := range drawn {
		ids = append(ids, record.ID)
	}
	stored, err := s.upsertToday(date, ids)
	if err != nil {
		return nil, err
	}
	return stored, nil
}

// GetToday returns today's challenge for a player.
func (s *Service) GetToday(role, playerID string) (*DailyChallenge, error) {
	date := UTCDateString()
	ids, err := s.resolveTodayIDs()
	if err != nil {
		return nil, err
	}
	records, err := s.locations.GetLocationsByIDs(ids)
	if err != nil {
		return nil, err
	}
	played, err := s.isClaimed(playerID, date)
	if err != nil {
		return nil, err
	}

	// A reseed may have invalidated today's stored set: redraw and repair.
	if len(records) < len(ids) {
		redrawn, err := s.locations.GetRandomLocations(locations.RandomLocationsQuery{Count: ChallengeRounds})
		if err != nil {
			return nil, err
		}
		newIDs := make([]int64, 0, len(redrawn))
		for _, record := range redrawn {
			newIDs = append(newIDs, record.ID)
		}
		_, _ = s.upsertToday(date, newIDs)
		return &DailyChallenge{Date: date, Locations: toPublic(redrawn), Played: played}, nil
	}
	return &DailyChallenge{Date: date, Locations: toPublic(records), Played: played}, nil
}

// GetTodayLocationRecords returns today's full records for authoritative
// settlement during game submission.
func (s *Service) GetTodayLocationRecords() ([]locations.LocationRecord, error) {
	ids, err := s.resolveTodayIDs()
	if err != nil {
		return nil, err
	}
	return s.locations.GetLocationsByIDs(ids)
}

// GuardDailySubmission enforces one daily submission per registered user.
func (s *Service) GuardDailySubmission(role, playerID string) error {
	if role != "user" {
		return httputil.BadRequest("每日挑战需登录后参与")
	}
	date := UTCDateString()
	claimed, err := s.tryClaim(playerID, date)
	if err != nil {
		return err
	}
	if !claimed {
		return httputil.Conflict("今日挑战已完成，不能重复提交")
	}
	return nil
}

func (s *Service) fetchTodayIDs(date string) ([]int64, error) {
	var raw string
	err := s.conn.QueryRow(
		`SELECT location_ids FROM daily_challenges WHERE date = ?`, date).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []int64
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

func (s *Service) upsertToday(date string, ids []int64) ([]int64, error) {
	raw, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	_, err = s.conn.Exec(
		`INSERT INTO daily_challenges (date, location_ids, created_at) VALUES (?, ?, ?)
		 ON CONFLICT(date) DO UPDATE SET location_ids = excluded.location_ids`,
		date, string(raw), util.Now())
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (s *Service) isClaimed(playerID, date string) (bool, error) {
	var n int
	err := s.conn.QueryRow(
		`SELECT COUNT(*) FROM daily_submissions WHERE player_id = ? AND date = ?`, playerID, date).Scan(&n)
	return n > 0, err
}

func (s *Service) tryClaim(playerID, date string) (bool, error) {
	result, err := s.conn.Exec(
		`INSERT INTO daily_submissions (player_id, date, game_id, created_at) VALUES (?, ?, 0, ?)
		 ON CONFLICT(player_id, date) DO NOTHING`,
		playerID, date, util.Now())
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

// MarkClaimed binds the claimed daily submission to the finished game id.
func (s *Service) MarkClaimed(playerID, date string, gameID int64) error {
	_, err := s.conn.Exec(
		`UPDATE daily_submissions SET game_id = ? WHERE player_id = ? AND date = ?`,
		gameID, playerID, date)
	return err
}

func toPublic(records []locations.LocationRecord) []PublicDailyLocation {
	out := make([]PublicDailyLocation, 0, len(records))
	for _, record := range records {
		out = append(out, PublicDailyLocation{
			ID:          record.ID,
			Name:        record.Name,
			Difficulty:  record.Difficulty,
			Region:      record.Region,
			MapillaryID: record.MapillaryID,
			PanoramaURL: record.PanoramaURL,
		})
	}
	return out
}
