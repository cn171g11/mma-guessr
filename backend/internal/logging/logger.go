package logging

import (
	"log/slog"
	"os"
	"strings"
)

// New returns a structured logger using slog with a text handler. Level is
// driven by LOG_LEVEL (debug/info/warn/error), defaulting to info.
func New() *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}

	handler := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})
	return slog.New(handler)
}
