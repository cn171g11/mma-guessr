package e2e

import (
	"net/http"
	"strings"
	"testing"
)

func TestVerificationCode(t *testing.T) {
	e := newTestEnv(t)

	t.Run("valid email returns 200", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/auth/verification-code", "", map[string]any{
			"email": randomEmail("code"),
		})
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if resp.str("message") == "" {
			t.Fatal("expected message field")
		}
	})

	t.Run("resend within 60s rejected", func(t *testing.T) {
		email := randomEmail("code")
		e.request(t, http.MethodPost, "/api/auth/verification-code", "", map[string]any{"email": email})
		second := e.request(t, http.MethodPost, "/api/auth/verification-code", "", map[string]any{"email": email})
		if second.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", second.status)
		}
	})

	t.Run("invalid email rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/auth/verification-code", "", map[string]any{"email": "not-an-email"})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("registered and unregistered emails behave alike", func(t *testing.T) {
		email := randomEmail("code")
		registerUser(t, e, "tester01", email, validPassword)

		again := e.request(t, http.MethodPost, "/api/auth/verification-code", "", map[string]any{"email": email})
		if again.status != http.StatusOK {
			t.Fatalf("expected 200 for registered email, got %d", again.status)
		}
		if again.str("message") == "" {
			t.Fatal("expected message field")
		}
	})
}

func TestRegister(t *testing.T) {
	e := newTestEnv(t)

	t.Run("register success returns user and token pair", func(t *testing.T) {
		email := randomEmail("reg")
		resp := registerUser(t, e, "tester01", email, validPassword)
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d", resp.status)
		}
		user := resp.nestedMap("user")
		if user["username"] != "tester01" {
			t.Fatalf("unexpected user: %v", user)
		}
		if _, leaked := user["email"]; leaked {
			t.Fatal("user payload must not expose the account email")
		}
		if resp.nestedStr("tokenPair", "accessToken") == "" {
			t.Fatal("expected accessToken")
		}
		if resp.nestedStr("tokenPair", "refreshToken") != "" {
			t.Fatal("refreshToken must not leak into the body")
		}
		if cookieValueOf(resp.header, "mma_refresh") == "" {
			t.Fatal("expected mma_refresh cookie")
		}

		me := e.request(t, http.MethodGet, "/api/auth/me", resp.nestedStr("tokenPair", "accessToken"), nil)
		if me.status != http.StatusOK {
			t.Fatalf("me failed: %d", me.status)
		}
		if me.str("role") != "user" {
			t.Fatalf("expected role user, got %s", me.str("role"))
		}
		if me.nestedStr("user", "id") != resp.nestedStr("user", "id") {
			t.Fatal("me user id mismatch")
		}
	})

	t.Run("duplicate email returns 409", func(t *testing.T) {
		email := randomEmail("reg")
		registerUser(t, e, uniqueUsername("tester"), email, validPassword)
		duplicate := e.request(t, http.MethodPost, "/api/auth/register", "", map[string]any{
			"username": uniqueUsername("tester"),
			"email":    email,
			"password": validPassword,
		})
		if duplicate.status != http.StatusConflict {
			t.Fatalf("expected 409, got %d", duplicate.status)
		}
	})

	t.Run("invalid username rejected", func(t *testing.T) {
		email := randomEmail("reg")
		resp := e.request(t, http.MethodPost, "/api/auth/register", "", map[string]any{
			"username": "x",
			"email":    email,
			"password": validPassword,
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("short password rejected", func(t *testing.T) {
		email := randomEmail("reg")
		resp := e.request(t, http.MethodPost, "/api/auth/register", "", map[string]any{
			"username": uniqueUsername("tester"),
			"email":    email,
			"password": "123",
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})
}

func TestLogin(t *testing.T) {
	e := newTestEnv(t)

	createAccount := func(t *testing.T) (username, email string) {
		t.Helper()
		username = uniqueUsername("tester")
		email = randomEmail("login")
		registerUser(t, e, username, email, validPassword)
		return username, email
	}

	t.Run("email login succeeds", func(t *testing.T) {
		_, email := createAccount(t)
		resp := e.request(t, http.MethodPost, "/api/auth/login", "", map[string]any{
			"identifier": email,
			"password":   validPassword,
		})
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if resp.nestedStr("tokenPair", "accessToken") == "" {
			t.Fatal("expected accessToken")
		}
	})

	t.Run("username login succeeds", func(t *testing.T) {
		username, _ := createAccount(t)
		resp := e.request(t, http.MethodPost, "/api/auth/login", "", map[string]any{
			"identifier": username,
			"password":   validPassword,
		})
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
	})

	t.Run("wrong password rejected", func(t *testing.T) {
		_, email := createAccount(t)
		resp := e.request(t, http.MethodPost, "/api/auth/login", "", map[string]any{
			"identifier": email,
			"password":   "wrong-password",
		})
		if resp.status != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.status)
		}
	})

	t.Run("locks after 5 failures", func(t *testing.T) {
		_, email := createAccount(t)
		for i := 0; i < 5; i++ {
			failed := e.request(t, http.MethodPost, "/api/auth/login", "", map[string]any{
				"identifier": email,
				"password":   "wrong-password",
			})
			if failed.status != http.StatusUnauthorized {
				t.Fatalf("expected 401 on attempt %d", i+1)
			}
		}
		locked := e.request(t, http.MethodPost, "/api/auth/login", "", map[string]any{
			"identifier": email,
			"password":   validPassword,
		})
		if locked.status != http.StatusUnauthorized {
			t.Fatalf("expected 401 when locked, got %d", locked.status)
		}
		if !strings.Contains(locked.str("error"), "锁定") {
			t.Fatalf("expected lock message, got %q", locked.str("error"))
		}
	})
}

func TestTokenLifecycle(t *testing.T) {
	e := newTestEnv(t)

	createSession := func(t *testing.T) (accessToken, refreshToken string) {
		t.Helper()
		email := randomEmail("token")
		resp := e.request(t, http.MethodPost, "/api/auth/register", "", map[string]any{
			"username": uniqueUsername("tester"),
			"email":    email,
			"password": validPassword,
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("register failed: %d", resp.status)
		}
		refresh := cookieValueOf(resp.header, "mma_refresh")
		if refresh == "" {
			t.Fatal("no refresh cookie issued")
		}
		return resp.nestedStr("tokenPair", "accessToken"), refresh
	}

	t.Run("refresh rotates and invalidates the old token", func(t *testing.T) {
		access, refresh := createSession(t)
		rotated := e.request(t, http.MethodPost, "/api/auth/refresh", "", map[string]any{"refreshToken": refresh})
		if rotated.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", rotated.status)
		}
		newAccess := rotated.nestedStr("tokenPair", "accessToken")
		if newAccess == "" || newAccess == access {
			t.Fatal("expected a fresh access token")
		}
		if rotated.nestedStr("tokenPair", "refreshToken") != "" {
			t.Fatal("refreshToken must not leak into the body")
		}
		if cookieValueOf(rotated.header, "mma_refresh") == "" {
			t.Fatal("expected rotated refresh cookie")
		}

		reused := e.request(t, http.MethodPost, "/api/auth/refresh", "", map[string]any{"refreshToken": refresh})
		if reused.status != http.StatusUnauthorized {
			t.Fatalf("expected 401 on reuse, got %d", reused.status)
		}
	})

	t.Run("logout revokes the refresh token", func(t *testing.T) {
		access, refresh := createSession(t)
		logout := e.request(t, http.MethodPost, "/api/auth/logout", access, map[string]any{"refreshToken": refresh})
		if logout.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", logout.status)
		}

		after := e.request(t, http.MethodPost, "/api/auth/refresh", "", map[string]any{"refreshToken": refresh})
		if after.status != http.StatusUnauthorized {
			t.Fatalf("expected 401 after logout, got %d", after.status)
		}
	})

	t.Run("me without token rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/auth/me", "", nil)
		if resp.status != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.status)
		}
	})

	t.Run("me with forged token rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/auth/me", "forged-token", nil)
		if resp.status != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.status)
		}
	})
}

func TestGuest(t *testing.T) {
	e := newTestEnv(t)

	createGuest := func(t *testing.T) (guestID, guestToken string) {
		t.Helper()
		resp := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d", resp.status)
		}
		return resp.str("guestId"), resp.str("guestToken")
	}

	t.Run("guest session exposes guest identity", func(t *testing.T) {
		guestID, guestToken := createGuest(t)
		if guestID == "" || guestToken == "" {
			t.Fatal("expected guestId and guestToken")
		}
		me := e.request(t, http.MethodGet, "/api/auth/me", guestToken, nil)
		if me.status != http.StatusOK {
			t.Fatalf("me failed: %d", me.status)
		}
		if me.str("role") != "guest" {
			t.Fatalf("expected role guest, got %s", me.str("role"))
		}
		if me.nestedStr("profile", "guestId") != guestID {
			t.Fatal("guest profile id mismatch")
		}
	})

	t.Run("guest/bind migrates progress and clears the guest", func(t *testing.T) {
		guestID, guestToken := createGuest(t)
		seedProgress(t, e, "guest_progress", "guest_id", guestID, 12, 3450, 8900, 9)

		email := randomEmail("bind")
		resp := e.request(t, http.MethodPost, "/api/auth/guest/bind", "", map[string]any{
			"username":   "guestuser",
			"email":      email,
			"password":   validPassword,
			"guestToken": guestToken,
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %v", resp.status, resp.body)
		}

		userID := resp.nestedStr("user", "id")
		p := readProgress(t, e, "user_progress", "user_id", userID)
		if p[0] != 12 || p[1] != 3450 || p[2] != 8900 || p[3] != 9 {
			t.Fatalf("progress not migrated: %v", p)
		}

		if guestRowExists(t, e, "guest_sessions", guestID) {
			t.Fatal("guest session not cleared after bind")
		}
	})

	t.Run("register with guestToken migrates progress", func(t *testing.T) {
		guestID, guestToken := createGuest(t)
		seedProgress(t, e, "guest_progress", "guest_id", guestID, 5, 1200, 2200, 3)

		email := randomEmail("bind")
		resp := e.request(t, http.MethodPost, "/api/auth/register", "", map[string]any{
			"username":   "binduser",
			"email":      email,
			"password":   validPassword,
			"guestToken": guestToken,
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d", resp.status)
		}

		userID := resp.nestedStr("user", "id")
		p := readProgress(t, e, "user_progress", "user_id", userID)
		if p[0] != 5 || p[1] != 1200 || p[2] != 2200 || p[3] != 3 {
			t.Fatalf("progress not migrated: %v", p)
		}
	})

	t.Run("bind rejects a user token", func(t *testing.T) {
		userAccess := registerUser(t, e, uniqueUsername("tester"), randomEmail("bind"), validPassword).nestedStr("tokenPair", "accessToken")
		email := randomEmail("bind")
		resp := e.request(t, http.MethodPost, "/api/auth/guest/bind", "", map[string]any{
			"username":   "binduser",
			"email":      email,
			"password":   validPassword,
			"guestToken": userAccess,
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})
}
