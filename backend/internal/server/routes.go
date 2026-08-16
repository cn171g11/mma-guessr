package server

import (
	"net/http"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
)

const (
	codeRateMax     = 60
	guestRateMax    = 60
	loginRateMax    = 30
	registerRateMax = 30
	logoutRateMax   = 60
	refreshRateMax  = 120
	gamesRateMax    = 10
	randomRateMax   = 120
	boardRateMax    = 120
	searchRateMax   = 30
	imageRateMax    = 60

	codeWindow     = 10 * time.Minute
	guestWindow    = 5 * time.Minute
	loginWindow    = 15 * time.Minute
	registerWindow = 15 * time.Minute
	logoutWindow   = 15 * time.Minute
	refreshWindow  = 10 * time.Minute
	gamesWindow    = 1 * time.Minute
	randomWindow   = 1 * time.Minute
	boardWindow    = 1 * time.Minute
	proxyWindow    = 1 * time.Minute
)

// registerRoutes mounts all API handlers under /api plus the socket.io
// polling transport.
func (s *Server) registerRoutes(mux *http.ServeMux) {
	// Health probe.
	mux.HandleFunc("GET /api/health", s.handleHealth)

	// Metrics endpoint (Prometheus text format).
	mux.HandleFunc("GET /api/metrics", s.handleMetrics)

	// Auth routes (IP rate-limited, matching the previous backend).
	mux.Handle("POST /api/auth/verification-code", middleware.RateLimit("rl:auth-code", codeWindow, codeRateMax, nil)(http.HandlerFunc(s.handleVerificationCode)))
	mux.Handle("POST /api/auth/register", middleware.RateLimit("rl:auth-register", registerWindow, registerRateMax, nil)(http.HandlerFunc(s.handleRegister)))
	mux.Handle("POST /api/auth/guest/bind", middleware.RateLimit("rl:auth-bind", registerWindow, registerRateMax, nil)(http.HandlerFunc(s.handleBind)))
	mux.Handle("POST /api/auth/login", middleware.RateLimit("rl:auth-login", loginWindow, loginRateMax, nil)(http.HandlerFunc(s.handleLogin)))
	mux.Handle("POST /api/auth/refresh", middleware.RateLimit("rl:auth-refresh", refreshWindow, refreshRateMax, nil)(http.HandlerFunc(s.handleRefresh)))
	mux.Handle("POST /api/auth/logout", middleware.RequireAuth(s.services.Tokens)(middleware.RateLimit("rl:auth-logout", logoutWindow, logoutRateMax, nil)(http.HandlerFunc(s.handleLogout))))
	mux.Handle("POST /api/auth/guest", middleware.RateLimit("rl:auth-guest", guestWindow, guestRateMax, nil)(http.HandlerFunc(s.handleGuest)))
	mux.Handle("GET /api/auth/me", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleMe)))

	// Games.
	mux.Handle("POST /api/games", middleware.RequireAuth(s.services.Tokens)(middleware.RateLimit("rl:games-submit", gamesWindow, gamesRateMax, gamesIdentity)(http.HandlerFunc(s.handleGamesSubmit))))
	mux.Handle("GET /api/games/recent", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleGamesRecent)))
	mux.Handle("GET /api/games/best", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleGamesBest)))
	mux.Handle("GET /api/games/summary", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleGamesSummary)))
	mux.Handle("DELETE /api/games/{gameId}", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleGamesDelete)))

	// Locations.
	mux.Handle("GET /api/locations/random", middleware.RateLimit("rl:locations-random", randomWindow, randomRateMax, nil)(http.HandlerFunc(s.handleLocationsRandom)))
	mux.HandleFunc("GET /api/locations/stats", s.handleLocationsStats)

	// Daily challenge.
	mux.Handle("GET /api/daily/today", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleDailyToday)))

	// Leaderboard.
	mux.Handle("GET /api/leaderboard", middleware.RateLimit("rl:leaderboard", boardWindow, boardRateMax, nil)(http.HandlerFunc(s.handleLeaderboard)))

	// Profile.
	mux.Handle("GET /api/profile", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleProfile)))

	// Achievements.
	mux.Handle("GET /api/achievements", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleAchievements)))
	mux.Handle("PUT /api/achievements/title", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleAchievementsPutTitle)))
	mux.Handle("DELETE /api/achievements/title", middleware.RequireAuth(s.services.Tokens)(http.HandlerFunc(s.handleAchievementsDeleteTitle)))

	// Mapillary proxy.
	mux.Handle("GET /api/proxy/mapillary/search", middleware.RateLimit("rl:mapillary-search", proxyWindow, searchRateMax, nil)(http.HandlerFunc(s.handleMapillarySearch)))
	mux.Handle("GET /api/proxy/mapillary/image/{imageId}", middleware.RateLimit("rl:mapillary-image", proxyWindow, imageRateMax, nil)(http.HandlerFunc(s.handleMapillaryImage)))
	mux.Handle("GET /api/proxy/imagery/{source}/search", middleware.RateLimit("rl:imagery-search", proxyWindow, searchRateMax, nil)(http.HandlerFunc(s.handleImagerySearch)))
	mux.Handle("GET /api/proxy/imagery/{source}/image/{imageId}", middleware.RateLimit("rl:imagery-image", proxyWindow, imageRateMax, nil)(http.HandlerFunc(s.handleImageryImage)))

	// Socket.IO polling transport (Engine.IO v4, polling only).
	if s.services.Multiplayer != nil {
		mux.Handle("GET /socket.io", s.services.Multiplayer.Transport())
		mux.Handle("GET /socket.io/", s.services.Multiplayer.Transport())
		mux.Handle("POST /socket.io", s.services.Multiplayer.Transport())
		mux.Handle("POST /socket.io/", s.services.Multiplayer.Transport())
	}

	// 404 for any unhandled path under /api.
	mux.HandleFunc("/api/", middleware.NotFound)

	// Root banner.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		httputil.WriteJSON(w, http.StatusOK, map[string]string{
			"name":   "mma-guessr-backend",
			"status": "ok",
		})
	})
}

// gamesIdentity keys the games-submit rate limit by IP + identity so guests
// cannot bypass it by rotating guest accounts.
func gamesIdentity(r *http.Request) string {
	role, subject := "anon", ""
	if identity, ok := middleware.IdentityFrom(r.Context()); ok {
		role, subject = identity.Role, identity.Subject
	}
	return middleware.ClientIP(r) + ":" + role + ":" + subject
}
