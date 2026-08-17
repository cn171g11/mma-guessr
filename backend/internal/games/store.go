package games

import (
	"database/sql"
	"encoding/json"
	"errors"

	"mma-guessr/backend/internal/util"
)

// Store provides data access for game results.
type Store struct {
	conn *sql.DB
}

// NewStore creates a games Store.
func NewStore(conn *sql.DB) *Store {
	return &Store{conn: conn}
}

// InsertGameRecord persists a verified game and returns the stored record.
func (s *Store) InsertGameRecord(player PlayerRef, input SubmitGameInput) (*GameRecord, error) {
	roundsJSON, err := json.Marshal(input.Rounds)
	if err != nil {
		return nil, err
	}
	now := util.Now()
	result, err := s.conn.Exec(
		`INSERT INTO game_results (player_type, player_id, mode, region, total_score, rounds, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		player.Role, player.ID, input.Mode, input.Region, input.TotalScore, string(roundsJSON), now)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &GameRecord{
		ID:         id,
		Mode:       input.Mode,
		Region:     input.Region,
		TotalScore: input.TotalScore,
		Rounds:     input.Rounds,
		CreatedAt:  now,
	}, nil
}

// FetchRecentGames returns the player's latest games, newest first.
func (s *Store) FetchRecentGames(player PlayerRef, limit int) ([]GameRecord, error) {
	rows, err := s.conn.Query(
		`SELECT id, mode, region, total_score, rounds, created_at FROM game_results
		 WHERE player_type = ? AND player_id = ?
		 ORDER BY created_at DESC, id DESC
		 LIMIT ?`,
		player.Role, player.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var games []GameRecord
	for rows.Next() {
		game, err := scanGame(rows)
		if err != nil {
			return nil, err
		}
		games = append(games, *game)
	}
	return games, rows.Err()
}

// FetchBestGame returns the player's best game for a mode, or nil.
func (s *Store) FetchBestGame(player PlayerRef, mode string) (*GameRecord, error) {
	row := s.conn.QueryRow(
		`SELECT id, mode, region, total_score, rounds, created_at FROM game_results
		 WHERE player_type = ? AND player_id = ? AND mode = ?
		 ORDER BY total_score DESC, created_at DESC
		 LIMIT 1`,
		player.Role, player.ID, mode)
	game, err := scanGame(row)
	if err != nil {
		return nil, err
	}
	if game == nil {
		return nil, nil
	}
	return game, nil
}

// FetchGame returns a single game owned by the player, or nil.
func (s *Store) FetchGame(player PlayerRef, gameID int64) (*GameRecord, error) {
	row := s.conn.QueryRow(
		`SELECT id, mode, region, total_score, rounds, created_at FROM game_results
		 WHERE id = ? AND player_type = ? AND player_id = ?`,
		gameID, player.Role, player.ID)
	game, err := scanGame(row)
	if err != nil {
		return nil, err
	}
	if game == nil {
		return nil, nil
	}
	return game, nil
}

// DeleteGameRecord removes a game owned by the player. Returns false when
// the game does not exist.
func (s *Store) DeleteGameRecord(player PlayerRef, gameID int64) (bool, error) {
	result, err := s.conn.Exec(
		`DELETE FROM game_results WHERE id = ? AND player_type = ? AND player_id = ?`,
		gameID, player.Role, player.ID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

type gameScanner interface {
	Scan(dest ...any) error
}

func scanGame(row gameScanner) (*GameRecord, error) {
	var game GameRecord
	var region sql.NullString
	var roundsJSON string
	err := row.Scan(&game.ID, &game.Mode, &region, &game.TotalScore, &roundsJSON, &game.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if region.Valid {
		game.Region = &region.String
	}
	if err := json.Unmarshal([]byte(roundsJSON), &game.Rounds); err != nil {
		return nil, err
	}
	return &game, nil
}
