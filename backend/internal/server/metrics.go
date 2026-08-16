package server

import (
	"crypto/subtle"
	"net/http"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
)

// handleMetrics renders the Prometheus text exposition. When METRICS_TOKEN
// is configured a Bearer token is required; production without a token is
// refused outright.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	expected := s.cfg.MetricsToken
	if expected == "" && s.cfg.IsProduction() {
		httputil.WriteError(w, http.StatusUnauthorized, "指标端点未启用（需配置 METRICS_TOKEN）")
		return
	}
	if expected != "" {
		token := middleware.BearerToken(r)
		if token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 {
			httputil.WriteError(w, http.StatusUnauthorized, "获取指标需要有效令牌")
			return
		}
	}

	stats := s.conn.Stats()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(s.registry.Render(int64(stats.OpenConnections), int64(stats.Idle), int64(stats.WaitCount))))
}
