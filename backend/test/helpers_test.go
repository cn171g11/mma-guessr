package e2e

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"mma-guessr/backend/internal/achievements"
	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/config"
	"mma-guessr/backend/internal/daily"
	"mma-guessr/backend/internal/db"
	"mma-guessr/backend/internal/facts"
	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/kv"
	"mma-guessr/backend/internal/leaderboard"
	"mma-guessr/backend/internal/locations"
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

const (
	validPassword      = "secret123"
	testAccessSecret   = "test-access-secret-0123456789abcdef"
	testRefreshSecret  = "test-refresh-secret-0123456789abcdef"
	testVerifySecret   = "test-verify-secret-0123456789abcdef"
	testEmailHashSecret = "test-email-hash-secret-0123456789abcdef"
)

var uniqueCounter atomic.Int64

func randomEmail(prefix string) string {
	return prefix + strconv.FormatInt(uniqueCounter.Add(1), 10) + "@example.com"
}

func uniqueUsername(base string) string {
	return base + strconv.FormatInt(uniqueCounter.Add(1), 10)
}

// testEnv wires a fresh in-memory backend for one test suite run.
type testEnv struct {
	conn         *sql.DB
	ts           *httptest.Server
	verify       *auth.VerificationStore
	tokens       *auth.TokenService
	games        *games.Service
	locations    *locations.Store
	multiplayer  *multiplayer.Service
	mapillary    *mapillary.Service
	verifyTTL    int
	verifyResend int
	refreshTTL   int
}

// response is a decoded HTTP response.
type response struct {
	status int
	body   map[string]any
	header http.Header
}

func (r *response) str(key string) string {
	v, _ := r.body[key].(string)
	return v
}

func (r *response) nestedStr(keys ...string) string {
	var cur any = r.body
	for _, k := range keys {
		m, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = m[k]
	}
	s, _ := cur.(string)
	return s
}

func (r *response) nestedMap(keys ...string) map[string]any {
	var cur any = r.body
	for _, k := range keys {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[k]
	}
	m, _ := cur.(map[string]any)
	return m
}

func (r *response) nestedArray(keys ...string) []any {
	var cur any = r.body
	for _, k := range keys {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[k]
	}
	arr, _ := cur.([]any)
	return arr
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	if err := db.Migrate(conn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	cfg := &config.Config{
		Environment:        "development",
		Port:               "0",
		SQLitePath:         ":memory:",
		AccessSecret:       testAccessSecret,
		RefreshSecret:      testRefreshSecret,
		VerifyCodeSecret:   testVerifySecret,
		CORSAllowedOrigins: []string{"http://localhost:3000"},
		CookieSameSite:     "lax",
		SponsorAdminToken:  "test-admin-token",
		OAuthStateSecret:   "test-oauth-state-secret-0123456789abcdef",
		FrontendOrigin:     "http://localhost:3000",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tokens := auth.NewTokenService(
		testAccessSecret, testRefreshSecret,
		15*time.Minute, 30*24*time.Hour, 7*24*time.Hour,
	)
	store := auth.NewStore(conn, testEmailHashSecret)
	verifyStore := auth.NewVerificationStore(conn, testVerifySecret)
	refreshStore := auth.NewRefreshStore(conn)
	loginGuard := auth.NewLoginGuard(5, 15*time.Minute, 15*time.Minute)
	authSvc := auth.NewService(
		store, verifyStore, refreshStore, tokens, loginGuard, mail.Config{}, logger, "development",
		15*60, 7*24*60*60, 30*24*60*60, 10*60, 5, 60,
	)

	cache := kv.New(conn)
	locationsStore := locations.NewStore(conn, cache)
	dailySvc := daily.NewService(conn, locationsStore)
	leaderboardSvc := leaderboard.NewService(conn)
	profileSvc := profile.NewService(conn, cache)
	achievementsSvc := achievements.NewService(conn, logger)
	ratingsSvc := ratings.NewService(conn)
	socialSvc := social.NewService(conn)
	factsSvc := facts.NewService(conn)
	_ = factsSvc.Seed()
	gamesStore := games.NewStore(conn)
	packsSvc := packs.NewService(packs.NewStore(conn))
	gamesSvc := games.NewService(gamesStore, store, dailySvc, leaderboardSvc, achievementsSvc, profileSvc, ratingsSvc, packsSvc)
	mapillarySvc := mapillary.NewService("", cache)

	engine := multiplayer.NewEngineIO(logger)
	mp := multiplayer.NewService(engine, store, locationsStore, gamesSvc, tokens, ratingsSvc, logger)
	engine.SetHandler(mp)
	t.Cleanup(mp.Stop)

	oauthSvc := oauth.NewService(cfg.OAuthStateSecret, fakeOAuthProvider{})

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

	srv := server.New(cfg, conn, logger, services, metrics.NewRegistry(nil))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	return &testEnv{
		conn: conn, ts: ts, verify: verifyStore, tokens: tokens,
		games: gamesSvc, locations: locationsStore, multiplayer: mp, mapillary: mapillarySvc,
		verifyTTL: 10 * 60, verifyResend: 60, refreshTTL: 7 * 24 * 60 * 60,
	}
}

// primeCode records a verification code directly, bypassing SMTP.
func (e *testEnv) primeCode(email string) string {
	code, httpErr := e.verify.SendCode(email, e.verifyTTL, e.verifyResend)
	if httpErr != nil {
		panic(httpErr)
	}
	return code
}

// seedLocations inserts n test locations with known coordinates.
func (e *testEnv) seedLocations(n int) {
	for i := 0; i < n; i++ {
		lat := 30.0 + float64(i%10)
		lng := 100.0 + float64(i%20)
		region := "asia"
		if i%6 == 1 {
			region = "europe"
		}
		if _, err := e.conn.Exec(
			`INSERT INTO locations (name, mapillary_id, lat, lng, country, city, region, difficulty, panorama_url, source, created_at, updated_at)
			 VALUES (?, NULL, ?, ?, '中国', '测试城', ?, ?, NULL, 'mapillary', ?, ?)`,
			"测试地点"+strconv.Itoa(i+1), lat, lng, region, i%5+1, time.Now().UTC().Format("2006-01-02T15:04:05Z"),
			time.Now().UTC().Format("2006-01-02T15:04:05Z")); err != nil {
			panic(err)
		}
	}
}

// seedLocationsTyped inserts locations with full control over fields.
func (e *testEnv) seedLocationsTyped(locations []struct {
	Name       string
	Lat, Lng   float64
	Region     string
	Difficulty int
}) {
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	for _, loc := range locations {
		if _, err := e.conn.Exec(
			`INSERT INTO locations (name, mapillary_id, lat, lng, country, city, region, difficulty, panorama_url, source, created_at, updated_at)
			 VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?, NULL, 'mapillary', ?, ?)`,
			loc.Name, loc.Lat, loc.Lng, loc.Region, loc.Difficulty, now, now); err != nil {
			panic(err)
		}
	}
}

// request performs a JSON API call and decodes the response.
func (e *testEnv) request(t *testing.T, method, path, token string, body any) *response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.ts.URL+path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, _ := io.ReadAll(res.Body)
	parsed := make(map[string]any)
	_ = json.Unmarshal(raw, &parsed)
	return &response{status: res.StatusCode, body: parsed, header: res.Header}
}

// requestWithCookies posts an empty JSON body with a raw Cookie header (e.g.
// a Set-Cookie value captured from an earlier response).
func (e *testEnv) requestWithCookies(t *testing.T, path, rawCookie string) *response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, e.ts.URL+path, strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if rawCookie != "" {
		req.Header.Set("Cookie", rawCookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, _ := io.ReadAll(res.Body)
	parsed := make(map[string]any)
	_ = json.Unmarshal(raw, &parsed)
	return &response{status: res.StatusCode, body: parsed, header: res.Header}
}

// cookieValueOf extracts a cookie value from the Set-Cookie header.
func cookieValueOf(header http.Header, name string) string {
	for _, line := range header.Values("Set-Cookie") {
		if strings.HasPrefix(line, name+"=") {
			return strings.SplitN(line, ";", 2)[0][len(name)+1:]
		}
	}
	return ""
}

func registerUser(t *testing.T, e *testEnv, username, email, password string) *response {
	t.Helper()
	resp := e.request(t, http.MethodPost, "/api/auth/register", "", map[string]any{
		"username": username,
		"email":    email,
		"password": password,
	})
	if resp.status != http.StatusCreated {
		t.Fatalf("register failed: %d %v", resp.status, resp.body)
	}
	return resp
}

func seedProgress(t *testing.T, e *testEnv, table, idCol, id string, rounds, score, best, correct int) {
	t.Helper()
	_, err := e.conn.Exec(
		`INSERT INTO `+table+` (`+idCol+`, total_rounds, total_score, best_score, correct_guesses)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(`+idCol+`) DO UPDATE SET
			total_rounds = excluded.total_rounds,
			total_score = excluded.total_score,
			best_score = excluded.best_score,
			correct_guesses = excluded.correct_guesses`,
		id, rounds, score, best, correct)
	if err != nil {
		t.Fatalf("seed %s: %v", table, err)
	}
}

func readProgress(t *testing.T, e *testEnv, table, idCol, id string) [4]int {
	t.Helper()
	var out [4]int
	err := e.conn.QueryRow(
		`SELECT total_rounds, total_score, best_score, correct_guesses FROM `+table+` WHERE `+idCol+` = ?`,
		id).Scan(&out[0], &out[1], &out[2], &out[3])
	if err != nil {
		t.Fatalf("read %s: %v", table, err)
	}
	return out
}

func guestRowExists(t *testing.T, e *testEnv, table, id string) bool {
	t.Helper()
	var n int
	err := e.conn.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE guest_id = ?`, id).Scan(&n)
	if err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n > 0
}

// fakeOAuthProvider is a deterministic OAuth provider for e2e tests: the
// authorize URL embeds the state, and any non-empty code maps to a stable
// identity. It exercises the full callback path without network access.
type fakeOAuthProvider struct{}

// Name is the provider key used in URLs and storage.
func (fakeOAuthProvider) Name() string { return "fake" }

// Label is the human-readable provider name.
func (fakeOAuthProvider) Label() string { return "Fake" }

// AuthorizeURL builds the consent URL carrying the signed state.
func (fakeOAuthProvider) AuthorizeURL(state string) string {
	return "https://fake-idp.example.com/authorize?state=" + url.QueryEscape(state)
}

// ExchangeCode maps the code to an identity; "bad" simulates a provider-side
// rejection, empty codes are treated as missing.
func (fakeOAuthProvider) ExchangeCode(_ context.Context, code string) (*oauth.Identity, error) {
	if code == "" || code == "bad" {
		return nil, httputil.Unauthorized("第三方授权失败")
	}
	return &oauth.Identity{ProviderID: "fake-" + code, Email: "fake-" + code + "@oauth.local", Name: "Fake " + code}, nil
}
