package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"mma-guessr/backend/internal/achievements"
	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/config"
	"mma-guessr/backend/internal/daily"
	"mma-guessr/backend/internal/db"
	"mma-guessr/backend/internal/facts"
	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/kv"
	"mma-guessr/backend/internal/leaderboard"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/logging"
	"mma-guessr/backend/internal/mail"
	"mma-guessr/backend/internal/mapillary"
	"mma-guessr/backend/internal/metrics"
	"mma-guessr/backend/internal/multiplayer"
	"mma-guessr/backend/internal/oauth"
	"mma-guessr/backend/internal/packs"
	"mma-guessr/backend/internal/profile"
	"mma-guessr/backend/internal/ratings"
	"mma-guessr/backend/internal/server"
	"mma-guessr/backend/internal/social"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

const (
	// maintenanceInterval is how often expired rows are swept from SQLite.
	// A 10-minute cadence keeps the request-nonce table small even under a
	// sustained flood of validly-signed requests (the HMAC secret is public
	// in the static frontend, so replay-protection nonces are insert-only).
	maintenanceInterval = 10 * time.Minute
	// shutdownGracePeriod bounds how long the server waits for in-flight
	// requests to drain before forcing a close.
	shutdownGracePeriod = 10 * time.Second
)

// serveUntilSignal blocks until the HTTP server stops or the process context
// is cancelled; on a signal it stops the multiplayer engine and drains
// in-flight requests gracefully. A nil error means a clean stop.
func serveUntilSignal(httpServer *http.Server, mp *multiplayer.Service, logger *slog.Logger, ctx context.Context) error {
	serverErr := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received")
		mp.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGracePeriod)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	}
}

func main() {
	logger := logging.New()

	cfg, err := config.Load()
	if err != nil {
		logger.Error("load config", "error", err)
		os.Exit(1)
	}

	// Apply GC tuning before any significant allocation so the heap goal and
	// soft limit are in effect for the whole process lifetime.
	debug.SetGCPercent(cfg.GCPercent)
	if cfg.MemoryLimitBytes > 0 {
		debug.SetMemoryLimit(cfg.MemoryLimitBytes)
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

	factsSvc := facts.NewService(conn)
	if err := factsSvc.Seed(); err != nil {
		logger.Error("seed facts", "error", err)
	}

	tokens := auth.NewTokenService(
		cfg.AccessSecret,
		cfg.RefreshSecret,
		time.Duration(config.AppConstants.AccessTTLSeconds)*time.Second,
		time.Duration(config.AppConstants.GuestTTLSeconds)*time.Second,
		time.Duration(config.AppConstants.RefreshTTLSeconds)*time.Second,
	)

	store := auth.NewStore(conn, cfg.EmailHashSecret)
	verifyStore := auth.NewVerificationStore(conn, cfg.VerifyCodeSecret)
	refreshStore := auth.NewRefreshStore(conn)
	loginGuard := auth.NewLoginGuard(
		config.AppConstants.LoginMaxAttempts,
		time.Duration(config.AppConstants.LoginLockSeconds)*time.Second,
		time.Duration(config.AppConstants.LoginLockSeconds)*time.Second,
	)
	mailer := mail.Config{
		Host: cfg.SMTPHost,
		Port: cfg.SMTPPort,
		User: cfg.SMTPUser,
		Pass: cfg.SMTPPass,
		From: cfg.SMTPFrom,
	}
	authSvc := auth.NewService(
		store, verifyStore, refreshStore, tokens, loginGuard, mailer, logger, cfg.Environment,
		config.AppConstants.AccessTTLSeconds,
		config.AppConstants.RefreshTTLSeconds,
		config.AppConstants.GuestTTLSeconds,
		config.AppConstants.VerifyCodeTTLSeconds,
		config.AppConstants.VerifyCodeMaxAttempts,
		config.AppConstants.VerifyCodeResendSeconds,
	)

	cache := kv.New(conn)
	locationsStore := locations.NewStore(conn, cache)
	dailySvc := daily.NewService(conn, locationsStore)
	leaderboardSvc := leaderboard.NewService(conn)
	profileSvc := profile.NewService(conn, cache)
	achievementsSvc := achievements.NewService(conn, logger)
	ratingsSvc := ratings.NewService(conn)
	socialSvc := social.NewService(conn)
	gamesStore := games.NewStore(conn)
	packsSvc := packs.NewService(packs.NewStore(conn))
	gamesSvc := games.NewService(gamesStore, store, dailySvc, leaderboardSvc, achievementsSvc, profileSvc, ratingsSvc, packsSvc)
	mapillarySvc := mapillary.NewService(cfg.MapillaryToken, cache)

	engine := multiplayer.NewEngineIO(logger)
	mp := multiplayer.NewService(engine, store, locationsStore, gamesSvc, tokens, ratingsSvc, logger)
	engine.SetHandler(mp)

	// Optional third-party sign-in: only constructed when the provider
	// credentials are present in the environment; the endpoints then degrade
	// to an empty provider list / 404 for the unconfigured case.
	var oauthSvc *oauth.Service
	if cfg.GoogleOAuthClientID != "" && cfg.GoogleOAuthSecret != "" && cfg.GoogleOAuthRedirectURI != "" {
		google := oauth.NewGoogleProvider(cfg.GoogleOAuthClientID, cfg.GoogleOAuthSecret, cfg.GoogleOAuthRedirectURI)
		oauthSvc = oauth.NewService(cfg.OAuthStateSecret, google)
	}

	registry := metrics.NewRegistry(nil)

	services := server.Services{
		Tokens:       tokens,
		Auth:         authSvc,
		Games:        gamesSvc,
		Locations:    locationsStore,
		Daily:        dailySvc,
		Leaderboard:  leaderboardSvc,
		Profile:      profileSvc,
		Achievements: achievementsSvc,
		Mapillary:    mapillarySvc,
		Multiplayer:  mp,
		Ratings:      ratingsSvc,
		Social:       socialSvc,
		Facts:        factsSvc,
		OAuth:        oauthSvc,
		Packs:        packsSvc,
		Cache:        cache,
	}

	srv := server.New(cfg, conn, logger, services, registry)
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	logger.Info("server starting", "port", cfg.Port, "env", cfg.Environment)

	// Background sweeper for expired rows; stops with the process context.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db.NewJanitor(conn, maintenanceInterval, logger).Start(ctx)
	// Recompute the leaderboard caches at each UTC midnight (matching the
	// previous backend's nightly rebuild), alongside the lazy on-read rebuild.
	leaderboardSvc.StartNightlyRebuild(ctx, logger)

	if err := serveUntilSignal(httpServer, mp, logger, ctx); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
