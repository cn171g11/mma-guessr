package config

import (
	"fmt"
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
	defaultSQLitePath    = "mma_guessr.db"
	defaultMapillaryDB   = "mapillary.db"
	defaultSigningSecret = "dev-signing-secret-change-me" // #nosec G101
)

// Config is the resolved runtime configuration loaded from environment.
type Config struct {
	Environment        string
	Port               string
	SQLitePath         string
	MapillaryDBPath    string
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
		MapillaryDBPath:  firstNonEmpty(os.Getenv("MAPILLARY_DB_PATH"), defaultMapillaryDB),
		MapillaryToken:   os.Getenv("MAPILLARY_TOKEN"),
		SMTPHost:         os.Getenv("SMTP_HOST"),
		SMTPPort:         465,
		SMTPUser:         os.Getenv("SMTP_USER"),
		SMTPPass:         os.Getenv("SMTP_PASS"),
		SMTPFrom:         os.Getenv("SMTP_FROM"),
		CookieSameSite:   firstNonEmpty(os.Getenv("COOKIE_SAME_SITE"), "lax"),
		MetricsToken:     os.Getenv("METRICS_TOKEN"),
		APISigningSecret: os.Getenv("API_SIGNING_SECRET"),
	}

	if v, ok := parseNonEmptyInt(os.Getenv("SMTP_PORT")); ok {
		cfg.SMTPPort = v
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
