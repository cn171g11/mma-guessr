package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open opens a SQLite database at path with WAL mode and reasonable
// concurrency settings. Modernc sqlite is pure Go and needs no CGO. The
// 20MiB page cache is a fixed, per-connection allocation that cuts repeated
// reads of hot tables (scores, leaderboard_best, mapillary_cache).
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-20480)", path)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	if err := conn.Ping(); err != nil {
		_ = conn.Close() // best-effort cleanup on open failure
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return conn, nil
}
