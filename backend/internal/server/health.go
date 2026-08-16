package server

import (
	"context"
	"net/http"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

// handleHealth reports service health by pinging the in-process SQLite store.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	dbUp := "down"
	status := "degraded"
	if err := s.conn.PingContext(ctx); err == nil {
		dbUp = "up"
		status = "ok"
	}

	code := http.StatusOK
	if status != "ok" {
		code = http.StatusServiceUnavailable
	}

	httputil.WriteJSON(w, code, map[string]any{
		"status": status,
		"checks": map[string]string{
			"sqlite": dbUp,
		},
		"timestamp": util.Now(),
	})
}
