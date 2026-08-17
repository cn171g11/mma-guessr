package db

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"mma-guessr/backend/internal/util"
)

// Janitor periodically removes expired rows (request nonces, verification
// codes, refresh tokens, guest sessions, TTL cache) so the database file and
// query times stay bounded over long uptimes.
type Janitor struct {
	conn     *sql.DB
	interval time.Duration
	logger   *slog.Logger
}

// NewJanitor creates a Janitor that sweeps every `interval`. An interval of
// zero disables the sweeper.
func NewJanitor(conn *sql.DB, interval time.Duration, logger *slog.Logger) *Janitor {
	return &Janitor{conn: conn, interval: interval, logger: logger}
}

// Start launches the background sweeper; it stops when ctx is cancelled.
func (j *Janitor) Start(ctx context.Context) {
	if j.interval <= 0 || j.conn == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(j.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				j.sweepOnce()
			case <-ctx.Done():
				return
			}
		}
	}()
}

// sweepOnce removes every expired row in the sweepable tables. Expiry is
// compared against RFC3339 timestamps stored by util.NowRFC3339Add, which is
// lexicographically ordered for equal formats.
func (j *Janitor) sweepOnce() {
	now := util.Now()
	statements := []string{
		`DELETE FROM nonces WHERE expires_at < ?`,
		`DELETE FROM verification_codes WHERE expires_at < ?`,
		`DELETE FROM refresh_tokens WHERE expires_at < ?`,
		`DELETE FROM guest_sessions WHERE expires_at < ?`,
		`DELETE FROM mapillary_cache WHERE expires_at < ?`,
	}
	for _, stmt := range statements {
		if _, err := j.conn.Exec(stmt, now); err != nil {
			j.logger.Warn("maintenance sweep failed", "error", err)
		}
	}
}
