package e2e

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// noRedirectClient surfaces 302 responses instead of following them, which is
// what the OAuth endpoints do.
var noRedirectClient = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}}

// rawGet performs a request without following redirects and returns the raw
// response for redirect assertions.
func (e *testEnv) rawGet(path string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, e.ts.URL+path, nil)
	if err != nil {
		return nil, err
	}
	return noRedirectClient.Do(req)
}

func TestOAuthProvidersListedWhenConfigured(t *testing.T) {
	e := newTestEnv(t)
	resp := e.request(t, http.MethodGet, "/api/oauth/providers", "", nil)
	if resp.status != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.status)
	}
	providers := resp.nestedArray("providers")
	if len(providers) != 1 {
		t.Fatalf("expected the fake provider, got %v", providers)
	}
	first := providers[0].(map[string]any)
	if first["name"] != "fake" || first["label"] != "Fake" {
		t.Fatalf("unexpected provider %v", first)
	}
}

func TestOAuthUnknownProviderIs404(t *testing.T) {
	e := newTestEnv(t)

	t.Run("authorize", func(t *testing.T) {
		resp, err := e.rawGet("/api/oauth/authorize/github")
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", resp.StatusCode)
		}
	})

	t.Run("callback", func(t *testing.T) {
		resp, err := e.rawGet("/api/oauth/callback/github?state=x&code=y")
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", resp.StatusCode)
		}
	})
}

func TestOAuthCallbackRejectsBadState(t *testing.T) {
	e := newTestEnv(t)
	resp, err := e.rawGet("/api/oauth/callback/fake?state=forged&code=abc")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("expected 302, got %d", resp.StatusCode)
	}
	location := resp.Header.Get("Location")
	if !strings.HasSuffix(location, "/?oauth=failed") {
		t.Fatalf("expected failure redirect, got %q", location)
	}
	if cookie := resp.Header.Get("Set-Cookie"); cookie != "" {
		t.Fatalf("failed callbacks must not set a session cookie, got %q", cookie)
	}
}

func TestOAuthFullFlow(t *testing.T) {
	e := newTestEnv(t)

	// Step 1: the authorize endpoint redirects to the IdP with a signed state.
	auth, err := e.rawGet("/api/oauth/authorize/fake")
	if err != nil {
		t.Fatalf("authorize request: %v", err)
	}
	auth.Body.Close()
	if auth.StatusCode != http.StatusFound {
		t.Fatalf("expected 302 from authorize, got %d", auth.StatusCode)
	}
	location, err := url.Parse(auth.Header.Get("Location"))
	if err != nil {
		t.Fatalf("parse authorize location %q: %v", auth.Header.Get("Location"), err)
	}
	state := location.Query().Get("state")
	if state == "" {
		t.Fatal("authorize URL must carry a state")
	}

	// Step 2: the callback exchanges the code, links the account and sets the
	// refresh cookie before redirecting back to the frontend.
	cb, err := e.rawGet("/api/oauth/callback/fake?state=" + url.QueryEscape(state) + "&code=abc")
	if err != nil {
		t.Fatalf("callback request: %v", err)
	}
	defer cb.Body.Close()
	if cb.StatusCode != http.StatusFound {
		t.Fatalf("expected 302 from callback, got %d", cb.StatusCode)
	}
	if loc := cb.Header.Get("Location"); !strings.HasSuffix(loc, "/?oauth=success") {
		t.Fatalf("expected success redirect, got %q", loc)
	}
	setCookie := cb.Header.Get("Set-Cookie")
	if !strings.Contains(setCookie, "mma_refresh=") {
		t.Fatalf("callback must set the refresh cookie, got %q", setCookie)
	}

	// Step 3: the frontend restores the session via the HttpOnly cookie.
	refresh := e.requestWithCookies(t, "/api/auth/refresh", setCookie)
	if refresh.status != http.StatusOK {
		t.Fatalf("refresh failed: %d %v", refresh.status, refresh.body)
	}
	access := refresh.nestedStr("tokenPair", "accessToken")
	if access == "" {
		t.Fatal("refresh must return an access token")
	}
	me := e.request(t, http.MethodGet, "/api/auth/me", access, nil)
	if me.status != http.StatusOK {
		t.Fatalf("me failed: %d %v", me.status, me.body)
	}
	if userID := me.nestedStr("user", "id"); userID == "" {
		t.Fatalf("expected a linked OAuth account, got %v", me.body)
	}
	if username := me.nestedStr("user", "username"); !strings.HasPrefix(username, "u") {
		t.Fatalf("expected an OAuth-derived username, got %q", username)
	}
	if _, leaked := me.nestedMap("user")["email"]; leaked {
		t.Fatal("user payload must not expose the account email")
	}

	// Step 4: repeating the callback with the same (now consumed) state must
	// fail, proving the state is single-use replay protection.
	cb2, err := e.rawGet("/api/oauth/callback/fake?state=" + url.QueryEscape(state) + "&code=abc")
	if err != nil {
		t.Fatalf("replay callback request: %v", err)
	}
	defer cb2.Body.Close()
	if loc := cb2.Header.Get("Location"); !strings.HasSuffix(loc, "/?oauth=failed") {
		t.Fatalf("replayed state must fail, got redirect %q", loc)
	}
}
