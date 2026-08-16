package kv

import (
	"database/sql"
	"time"

	"mma-guessr/backend/internal/util"
)

// Store is a small TTL cache over SQLite, replacing the Redis usage for
// caches (location pools, stats, mapillary responses, leaderboards).
type Store struct {
	conn *sql.DB
}

// New creates a Store backed by the given connection.
func New(conn *sql.DB) *Store {
	return &Store{conn: conn}
}

// Get returns the cached string value for key, or false when missing/expired.
func (s *Store) Get(key string) (string, bool) {
	var value, expiresAt string
	err := s.conn.QueryRow(
		`SELECT value, expires_at FROM mapillary_cache WHERE key = ?`, key).Scan(&value, &expiresAt)
	if err != nil {
		return "", false
	}
	if util.ParseTime(expiresAt).Before(util.NowTime()) {
		_ = s.Del(key)
		return "", false
	}
	return value, true
}

// GetBytes returns the cached byte value for key (binary-safe column).
func (s *Store) GetBytes(key string) ([]byte, bool) {
	var value []byte
	var expiresAt string
	err := s.conn.QueryRow(
		`SELECT value, expires_at FROM mapillary_cache WHERE key = ?`, key).Scan(&value, &expiresAt)
	if err != nil {
		return nil, false
	}
	if util.ParseTime(expiresAt).Before(util.NowTime()) {
		_ = s.Del(key)
		return nil, false
	}
	return value, true
}

// Set stores a string value with the given TTL, replacing any previous value.
func (s *Store) Set(key, value string, ttlSeconds int) error {
	_, err := s.conn.Exec(
		`INSERT INTO mapillary_cache (key, value, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
		key, value, util.NowRFC3339Add(ttlSeconds))
	return err
}

// SetBytes stores a byte value (images) with the given TTL.
func (s *Store) SetBytes(key string, value []byte, ttlSeconds int) error {
	_, err := s.conn.Exec(
		`INSERT INTO mapillary_cache (key, value, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
		key, value, util.NowRFC3339Add(ttlSeconds))
	return err
}

// Del removes a key.
func (s *Store) Del(key string) error {
	_, err := s.conn.Exec(`DELETE FROM mapillary_cache WHERE key = ?`, key)
	return err
}

// SetNX stores a value only if the key is absent. Returns true when stored.
func (s *Store) SetNX(key, value string, ttlSeconds int) (bool, error) {
	res, err := s.conn.Exec(
		`INSERT INTO mapillary_cache (key, value, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO NOTHING`,
		key, value, util.NowRFC3339Add(ttlSeconds))
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	return affected > 0, err
}

// Sweep removes expired entries. Call periodically or opportunistically.
func (s *Store) Sweep() {
	_, _ = s.conn.Exec(`DELETE FROM mapillary_cache WHERE expires_at < ?`, util.Now())
}

// TTL returns the remaining lifetime of a key in seconds (0 when absent).
func (s *Store) TTL(key string) int64 {
	var expiresAt string
	err := s.conn.QueryRow(
		`SELECT expires_at FROM mapillary_cache WHERE key = ?`, key).Scan(&expiresAt)
	if err != nil {
		return 0
	}
	remaining := time.Until(util.ParseTime(expiresAt)).Seconds()
	if remaining < 0 {
		return 0
	}
	return int64(remaining)
}
