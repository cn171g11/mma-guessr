package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// AppConstants holds business-level tuning values that mirror the previous
// Node backend's APP_CONSTANTS so that behavior stays byte-compatible.
var AppConstants = struct {
	ServiceVersion                string
	BcryptRounds                  int
	AccessTTLSeconds              int
	RefreshTTLSeconds             int
	VerifyCodeTTLSeconds          int
	VerifyCodeMaxAttempts         int
	VerifyCodeResendSeconds       int
	LoginMaxAttempts              int
	LoginLockSeconds              int
	GuestTTLSeconds               int
	LocationPoolTTLSeconds        int
	LocationStatsTTLSeconds       int
	LocationRandomMaxCount        int
	MapillaryTimeoutMS            int
	MapillarySearchTTL            int
	MapillaryMediaTTL             int
	MapillaryMaxSearchLimit       int
	MapillaryDefaultWidth         int
	MapillaryMaxWidth             int
	MapillaryRateSearchMax        int
	MapillaryRateImageMax         int
	GamesRateSubmitMax            int
	GamesRecentMaxLimit           int
	GamesRecentDefaultLimit       int
	MaxRoundScore                 int
	MaxTotalScore                 int
	MaxRoundsPerGame              int
	LeaderboardMaxLimit           int
	LeaderboardDefaultLimit       int
	LeaderboardDailyRetentionDays int
	DailyChallengeRounds          int
	ProfileStatsTTLSeconds        int
	MPTotalRounds                 int
	MPRoundSeconds                int
	MPMatchmakerTickMS            int
	MPRoomTTLSeconds              int
	MPEventRateWindowMS           int
	MPEventRateMax                int
}{
	ServiceVersion:                "1.18.0",
	BcryptRounds:                  12,
	AccessTTLSeconds:              15 * 60,
	RefreshTTLSeconds:             7 * 24 * 60 * 60,
	VerifyCodeTTLSeconds:          10 * 60,
	VerifyCodeMaxAttempts:         5,
	VerifyCodeResendSeconds:       60,
	LoginMaxAttempts:              5,
	LoginLockSeconds:              15 * 60,
	GuestTTLSeconds:               30 * 24 * 60 * 60,
	LocationPoolTTLSeconds:        60 * 60,
	LocationStatsTTLSeconds:       5 * 60,
	LocationRandomMaxCount:        20,
	MapillaryTimeoutMS:            10_000,
	MapillarySearchTTL:            24 * 60 * 60,
	MapillaryMediaTTL:             24 * 60 * 60,
	MapillaryMaxSearchLimit:       50,
	MapillaryDefaultWidth:         1024,
	MapillaryMaxWidth:             2048,
	MapillaryRateSearchMax:        30,
	MapillaryRateImageMax:         60,
	GamesRateSubmitMax:            10,
	GamesRecentMaxLimit:           30,
	GamesRecentDefaultLimit:       20,
	MaxRoundScore:                 5000,
	MaxTotalScore:                 1_000_000,
	MaxRoundsPerGame:              100,
	LeaderboardMaxLimit:           50,
	LeaderboardDefaultLimit:       20,
	LeaderboardDailyRetentionDays: 7,
	DailyChallengeRounds:          10,
	ProfileStatsTTLSeconds:        5 * 60,
	MPTotalRounds:                 5,
	MPRoundSeconds:                60,
	MPMatchmakerTickMS:            1500,
	MPRoomTTLSeconds:              2 * 60 * 60,
	MPEventRateWindowMS:           10 * 1000,
	MPEventRateMax:                20,
}

const (
	minSecretBytes = 32

	// Dev-only fallbacks; requiredSecret() rejects them in production and
	// enforces a minimum length for real values.
	devAccessSecret      = "dev-access-secret-change-me-0123456789abcdef"         // #nosec G101
	devRefreshSecret     = "dev-refresh-secret-change-me-0123456789abcdef"        // #nosec G101
	devVerifyCodeSecret  = "dev-verify-code-secret-not-for-production-0123456789" // #nosec G101
	devOAuthStateSecret  = "dev-oauth-state-secret-not-for-production-0123456789" // #nosec G101
	defaultSQLitePath    = "mma_guessr.db"
	defaultSigningSecret = "dev-signing-secret-change-me" // #nosec G101
)

// Config is the resolved runtime configuration loaded from environment.
type Config struct {
	Environment        string
	Port               string
	SQLitePath         string
	MapillaryToken     string
	AccessSecret       string
	RefreshSecret      string
	VerifyCodeSecret   string
	SMTPHost           string
	SMTPPort           int
	SMTPUser           string
	SMTPPass           string
	SMTPFrom           string
	CORSAllowedOrigins []string
	CookieSameSite     string
	MetricsToken       string
	APISigningSecret   string
	TrustProxy         bool
	// SponsorAdminToken authorizes the sponsor management endpoints. Empty in
	// development means the write endpoints stay locked.
	SponsorAdminToken string
	// GoogleOAuth* configure the Google sign-in provider (optional feature).
	GoogleOAuthClientID    string
	GoogleOAuthSecret      string
	GoogleOAuthRedirectURI string
	// OAuthStateSecret signs the OAuth state token (login CSRF / replay
	// protection). Only required when a Google OAuth provider is configured.
	OAuthStateSecret string
	// FrontendOrigin is where the OAuth callback redirects after sign-in. It
	// is derived from the CORS whitelist (the first configured origin).
	FrontendOrigin string
	// PayloadPadding adds a random _pad field to JSON object responses so
	// traffic length analysis cannot fingerprint API payload shapes. It is a
	// Low-level network hardening measure, recommended for production.
	PayloadPadding bool
	// GCPercent is the GOGC percentage (default 100; -1 means disabled).
	// Lower values make the GC run more often so the heap returns toward the
	// live set faster after load bursts; higher values reduce GC overhead.
	GCPercent int
	// MemoryLimitBytes is an optional soft heap cap for the Go runtime
	// (runtime/debug.SetMemoryLimit). 0 keeps the runtime default.
	MemoryLimitBytes int64
}

// Load reads configuration from environment variables with secure defaults.
func Load() (*Config, error) {
	env := os.Getenv("NODE_ENV")
	if env == "" {
		env = "development"
	}

	cfg := &Config{
		Environment:      env,
		Port:             firstNonEmpty(os.Getenv("PORT"), "3000"),
		SQLitePath:       firstNonEmpty(os.Getenv("SQLITE_PATH"), defaultSQLitePath),
		MapillaryToken:   os.Getenv("MAPILLARY_TOKEN"),
		SMTPHost:         os.Getenv("SMTP_HOST"),
		SMTPPort:         465,
		SMTPUser:         os.Getenv("SMTP_USER"),
		SMTPPass:         os.Getenv("SMTP_PASS"),
		SMTPFrom:         os.Getenv("SMTP_FROM"),
		CookieSameSite:     firstNonEmpty(os.Getenv("COOKIE_SAME_SITE"), "lax"),
		MetricsToken:       os.Getenv("METRICS_TOKEN"),
		SponsorAdminToken:  os.Getenv("SPONSOR_ADMIN_TOKEN"),
		GoogleOAuthClientID:    os.Getenv("GOOGLE_OAUTH_CLIENT_ID"),
		GoogleOAuthSecret:      os.Getenv("GOOGLE_OAUTH_SECRET"),
		GoogleOAuthRedirectURI: os.Getenv("GOOGLE_OAUTH_REDIRECT_URI"),
	}

	if v, ok := parseNonEmptyInt(os.Getenv("SMTP_PORT")); ok {
		cfg.SMTPPort = v
	}

	// GC tuning (cross-platform, mirrors Go's native GOGC / GOMEMLIMIT env
	// handling but also applies when the binary is wrapped by a launcher that
	// does not propagate the process environment).
	cfg.GCPercent = 100
	switch os.Getenv("GOGC") {
	case "":
	case "off":
		cfg.GCPercent = -1
	default:
		if v, ok := parseNonEmptyInt(os.Getenv("GOGC")); ok && v != 0 {
			cfg.GCPercent = v
		}
	}
	if raw := os.Getenv("GOMEMLIMIT"); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			cfg.MemoryLimitBytes = n
		}
	}

	// Payload padding is off by default; production deployments should opt in
	// via PAYLOAD_PADDING=1 (see .env.prod.example).
	switch strings.ToLower(os.Getenv("PAYLOAD_PADDING")) {
	case "1", "true", "on", "yes":
		cfg.PayloadPadding = true
	}

	var err error
	if cfg.AccessSecret, err = requiredSecret("JWT_ACCESS_SECRET", devAccessSecret, env); err != nil {
		return nil, err
	}
	if cfg.RefreshSecret, err = requiredSecret("JWT_REFRESH_SECRET", devRefreshSecret, env); err != nil {
		return nil, err
	}
	if cfg.VerifyCodeSecret, err = requiredSecret("VERIFY_CODE_SECRET", devVerifyCodeSecret, env); err != nil {
		return nil, err
	}

	// Request signing stays optional in development (matching the documented
	// local workflow) but is mandatory in production: silently running without
	// it would disable tamper/replay protection.
	if cfg.APISigningSecret, err = resolveSigningSecret(env); err != nil {
		return nil, err
	}

	if v, ok := parseNonEmptyInt(os.Getenv("TRUST_PROXY")); ok && v > 0 {
		cfg.TrustProxy = true
	}

	origins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if origins == "" {
		origins = "http://localhost:3000,http://127.0.0.1:3000"
	}
	for _, o := range strings.Split(origins, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			cfg.CORSAllowedOrigins = append(cfg.CORSAllowedOrigins, o)
		}
	}

	// The OAuth callback redirects to the frontend; take the first CORS
	// origin as the canonical one.
	if len(cfg.CORSAllowedOrigins) > 0 {
		cfg.FrontendOrigin = cfg.CORSAllowedOrigins[0]
	}

	// An OAuth redirect URI must be an exact, HTTPS callback (or a localhost
	// URL in development) — never an arbitrary origin.
	if cfg.GoogleOAuthRedirectURI != "" {
		uri, err := url.Parse(cfg.GoogleOAuthRedirectURI)
		if err != nil || uri.Host == "" || uri.Scheme != "https" {
			if !(cfg.Environment != "production" && strings.HasPrefix(cfg.GoogleOAuthRedirectURI, "http://localhost")) {
				return nil, fmt.Errorf("GOOGLE_OAUTH_REDIRECT_URI 必须是 HTTPS 回调地址")
			}
		}
	}

	// The state secret is only mandatory once a provider is configured; a
	// deployment that never enables OAuth should not need the extra secret.
	if cfg.GoogleOAuthClientID != "" || cfg.GoogleOAuthSecret != "" || cfg.GoogleOAuthRedirectURI != "" {
		if cfg.OAuthStateSecret, err = requiredSecret("OAUTH_STATE_SECRET", devOAuthStateSecret, env); err != nil {
			return nil, err
		}
	}

	return cfg, nil
}

// IsProduction reports whether the runtime environment is production.
func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

// Version returns the service version string.
func (c *Config) Version() string {
	return AppConstants.ServiceVersion
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func parseNonEmptyInt(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	return v, true
}

func requiredSecret(name, devFallback, environment string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		if environment == "production" {
			return "", fmt.Errorf("missing required environment variable: %s", name)
		}
		return devFallback, nil
	}
	if len(value) < minSecretBytes {
		return "", fmt.Errorf("environment variable %s must be at least %d bytes", name, minSecretBytes)
	}
	if environment == "production" && value == devFallback {
		return "", fmt.Errorf("environment variable %s must not use the development default", name)
	}
	return value, nil
}

// resolveSigningSecret enforces the request-signing secret only in production.
// Development keeps the documented short dev default so the out-of-box .env
// workflow keeps working; production requires a strong, non-default secret.
func resolveSigningSecret(environment string) (string, error) {
	value := os.Getenv("API_SIGNING_SECRET")
	if value == "" {
		if environment == "production" {
			return "", fmt.Errorf("missing required environment variable: API_SIGNING_SECRET")
		}
		return defaultSigningSecret, nil
	}
	if environment == "production" {
		if value == defaultSigningSecret {
			return "", fmt.Errorf("environment variable API_SIGNING_SECRET must not use the development default")
		}
		if len(value) < minSecretBytes {
			return "", fmt.Errorf("environment variable API_SIGNING_SECRET must be at least %d bytes", minSecretBytes)
		}
	}
	return value, nil
}
