package db

import (
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestJanitorSweepRemovesExpiredRowsOnly(t *testing.T) {
	conn, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	defer conn.Close()
	if err := Migrate(conn); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	expired := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
	live := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)

	// Each seed is (stmt, args); insert one expired and one live row per
	// sweepable table so the sweep must drop exactly the expired ones.
	seeds := []struct {
		stmt string
		args []any
	}{
		{`INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)`, []any{"expired-nonce", expired}},
		{`INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)`, []any{"live-nonce", live}},
		{`INSERT INTO verification_codes (email, code_hash, attempts, last_sent_at, expires_at)
		  VALUES (?, ?, 0, ?, ?)`, []any{"expired@example.com", "h", expired, expired}},
		{`INSERT INTO verification_codes (email, code_hash, attempts, last_sent_at, expires_at)
		  VALUES (?, ?, 0, ?, ?)`, []any{"live@example.com", "h", live, live}},
		{`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`, []any{"expired-user", "h", expired}},
		{`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`, []any{"live-user", "h", live}},
		{`INSERT INTO guest_sessions (guest_id, username, created_at, expires_at) VALUES (?, ?, ?, ?)`, []any{"expired-guest", "g", expired, expired}},
		{`INSERT INTO guest_sessions (guest_id, username, created_at, expires_at) VALUES (?, ?, ?, ?)`, []any{"live-guest", "g", live, live}},
		{`INSERT INTO mapillary_cache (key, value, expires_at) VALUES (?, ?, ?)`, []any{"expired-cache", "v", expired}},
		{`INSERT INTO mapillary_cache (key, value, expires_at) VALUES (?, ?, ?)`, []any{"live-cache", "v", live}},
	}
	for _, seed := range seeds {
		if _, err := conn.Exec(seed.stmt, seed.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	NewJanitor(conn, 0, logger).sweepOnce()

	tables := []struct {
		table   string
		keyCol  string
		liveKey string
	}{
		{"nonces", "nonce", "live-nonce"},
		{"verification_codes", "email", "live@example.com"},
		{"refresh_tokens", "user_id", "live-user"},
		{"guest_sessions", "guest_id", "live-guest"},
		{"mapillary_cache", "key", "live-cache"},
	}
	for _, tc := range tables {
		var remaining int
		if err := conn.QueryRow(`SELECT COUNT(*) FROM ` + tc.table).Scan(&remaining); err != nil {
			t.Fatalf("count %s: %v", tc.table, err)
		}
		if remaining != 1 {
			t.Errorf("table %s: expected 1 live row after sweep, got %d", tc.table, remaining)
		}
		var liveRows int
		if err := conn.QueryRow(`SELECT COUNT(*) FROM `+tc.table+` WHERE `+tc.keyCol+` = ?`, tc.liveKey).Scan(&liveRows); err != nil {
			t.Fatalf("query %s: %v", tc.table, err)
		}
		if liveRows != 1 {
			t.Errorf("table %s: live row %q was removed by sweep", tc.table, tc.liveKey)
		}
	}
}
