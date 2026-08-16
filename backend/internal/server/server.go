package server

import (
	"database/sql"
	"log/slog"
	"net/http"

	"mma-guessr/backend/internal/achievements"
	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/config"
	"mma-guessr/backend/internal/daily"
	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/kv"
	"mma-guessr/backend/internal/leaderboard"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/mapillary"
	"mma-guessr/backend/internal/metrics"
	"mma-guessr/backend/internal/middleware"
	"mma-guessr/backend/internal/multiplayer"
	"mma-guessr/backend/internal/profile"
)

// Services bundles the domain services the server needs.
type Services struct {
	Tokens       *auth.TokenService
	Auth         *auth.Service
	Games        *games.Service
	Locations    *locations.Store
	Daily        *daily.Service
	Leaderboard  *leaderboard.Service
	Profile      *profile.Service
	Achievements *achievements.Service
	Mapillary    *mapillary.Service
	Multiplayer  *multiplayer.Service
	Cache        *kv.Store
}

// Server wires together configuration, storage and HTTP middleware.
type Server struct {
	cfg      *config.Config
	conn     *sql.DB
	logger   *slog.Logger
	services Services
	registry *metrics.Registry
}

// New creates a Server with the given dependencies.
func New(cfg *config.Config, conn *sql.DB, logger *slog.Logger, services Services, registry *metrics.Registry) *Server {
	return &Server{
		cfg:      cfg,
		conn:     conn,
		logger:   logger,
		services: services,
		registry: registry,
	}
}

// Handler assembles the full middleware chain and route tree.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	s.registerRoutes(mux)

	chain := middleware.ErrorHandler(s.logger,
		middleware.SecurityHeaders(s.cfg.IsProduction())(
			middleware.CORS(s.cfg.CORSAllowedOrigins)(
				middleware.RequestLogger(s.logger)(
					middleware.MetricsMiddleware(s.registry)(
						middleware.NewAPISignature(s.cfg.APISigningSecret, s.conn)(
							mux,
						),
					),
				),
			),
		),
	)
	return chain
}
