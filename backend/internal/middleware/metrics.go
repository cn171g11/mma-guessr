package middleware

import (
	"net/http"
	"strings"
	"time"

	"mma-guessr/backend/internal/metrics"
)

// MetricsMiddleware records per-route request count and duration into the
// shared registry using the same label shapes as the previous backend
// (matched route pattern, numeric status).
func MetricsMiddleware(registry *metrics.Registry) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			registry.RecordRequest(r.Method, routeLabel(r.URL.Path), rec.status,
				float64(time.Since(start).Milliseconds()))
		})
	}
}

// routeLabel maps concrete paths onto the express-style route patterns.
func routeLabel(path string) string {
	trimmed := strings.TrimRight(path, "/")
	if trimmed == "" {
		return "/"
	}
	switch {
	case trimmed == "/api/health":
		return "/api/health"
	case trimmed == "/api/metrics":
		return "/api/metrics"
	case trimmed == "/api/auth/verification-code":
		return "/api/auth/verification-code"
	case trimmed == "/api/auth/register":
		return "/api/auth/register"
	case trimmed == "/api/auth/guest/bind":
		return "/api/auth/guest/bind"
	case trimmed == "/api/auth/login":
		return "/api/auth/login"
	case trimmed == "/api/auth/refresh":
		return "/api/auth/refresh"
	case trimmed == "/api/auth/logout":
		return "/api/auth/logout"
	case trimmed == "/api/auth/guest":
		return "/api/auth/guest"
	case trimmed == "/api/auth/me":
		return "/api/auth/me"
	case trimmed == "/api/games/recent":
		return "/api/games/recent"
	case trimmed == "/api/games/best":
		return "/api/games/best"
	case trimmed == "/api/games/summary":
		return "/api/games/summary"
	case trimmed == "/api/games":
		return "/api/games"
	case trimmed == "/api/locations/random":
		return "/api/locations/random"
	case trimmed == "/api/locations/stats":
		return "/api/locations/stats"
	case trimmed == "/api/daily/today":
		return "/api/daily/today"
	case trimmed == "/api/leaderboard":
		return "/api/leaderboard"
	case trimmed == "/api/profile":
		return "/api/profile"
	case trimmed == "/api/achievements":
		return "/api/achievements"
	case trimmed == "/api/achievements/title":
		return "/api/achievements/title"
	case trimmed == "/api/proxy/mapillary/search":
		return "/api/proxy/mapillary/search"
	case trimmed == "/api/proxy/imagery/:source/search":
		return "/api/proxy/imagery/:source/search"
	}

	switch {
	case strings.HasPrefix(trimmed, "/api/auth/"):
		return "/api/auth/:route"
	case strings.HasPrefix(trimmed, "/api/games/"):
		if trimmed == "/api/games" {
			return "/api/games"
		}
		return "/api/games/:gameId"
	case strings.HasPrefix(trimmed, "/api/proxy/mapillary/image/"):
		return "/api/proxy/mapillary/image/:imageId"
	case strings.HasPrefix(trimmed, "/api/proxy/imagery/"):
		if strings.Contains(trimmed, "/image/") {
			return "/api/proxy/imagery/:source/image/:imageId"
		}
		return "/api/proxy/imagery/:source/search"
	case strings.HasPrefix(trimmed, "/api/"):
		return "not_found"
	case trimmed == "/socket.io" || trimmed == "/socket.io/":
		return "not_found"
	}
	return "not_found"
}
