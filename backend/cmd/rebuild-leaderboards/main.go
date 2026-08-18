package main

import (
	"os"

	"mma-guessr/backend/internal/config"
	"mma-guessr/backend/internal/db"
	"mma-guessr/backend/internal/leaderboard"
	"mma-guessr/backend/internal/logging"
)

// rebuild-leaderboards recomputes the overall and today's daily leaderboard
// caches from the authoritative scores table, mirroring the previous
// backend's cli/rebuild-leaderboards.ts. Run it after restoring a database or
// when a scheduled rebuild did not run.
func main() {
	logger := logging.New()

	cfg, err := config.Load()
	if err != nil {
		logger.Error("load config", "error", err)
		os.Exit(1)
	}

	conn, err := db.Open(cfg.SQLitePath)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer conn.Close()

	if err := db.Migrate(conn); err != nil {
		logger.Error("migrate database", "error", err)
		os.Exit(1)
	}

	service := leaderboard.NewService(conn)
	if err := service.Rebuild(); err != nil {
		logger.Error("rebuild leaderboard", "error", err)
		os.Exit(1)
	}
	logger.Info("leaderboard rebuild completed")
}