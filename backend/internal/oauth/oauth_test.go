package oauth

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"mma-guessr/backend/internal/httputil"
)

const testStateSecret = "test-oauth-state-secret-0123456789abcdef"

func newTestService() *Service {
	return NewService(testStateSecret)
}

func TestBuildStateAndVerifyRoundTrip(t *testing.T) {
	svc := newTestService()
	state, err := svc.BuildState("google")
	if err != nil {
		t.Fatalf("BuildState: %v", err)
	}
	if !strings.Contains(state, ".") {
		t.Fatalf("state must be payload.signature, got %q", state)
	}
	if err := svc.VerifyState(state, "google"); err != nil {
		t.Fatalf("VerifyState should pass for a fresh token: %v", err)
	}
}

func TestVerifyStateRejectsWrongProvider(t *testing.T) {
	svc := newTestService()
	state, err := svc.BuildState("google")
	if err != nil {
		t.Fatalf("BuildState: %v", err)
	}
	if err := svc.VerifyState(state, "github"); err == nil {
		t.Fatal("expected error when the callback provider differs from the state")
	}
}

func TestVerifyStateRejectsTamperedPayload(t *testing.T) {
	svc := newTestService()
	state, err := svc.BuildState("google")
	if err != nil {
		t.Fatalf("BuildState: %v", err)
	}
	tampered := state[:1] + "x" + state[2:]
	if err := svc.VerifyState(tampered, "google"); err == nil {
		t.Fatal("expected error for a tampered token")
	}
}

func TestVerifyStateRejectsMalformedInput(t *testing.T) {
	svc := newTestService()
	cases := []string{"", "not-a-state", "a.b.c", "!!!.xxx"}
	for _, input := range cases {
		if err := svc.VerifyState(input, "google"); err == nil {
			t.Fatalf("expected error for malformed state %q", input)
		}
	}
}

func TestVerifyStateRejectsExpiredToken(t *testing.T) {
	svc := newTestService()
	// Build a token whose issue time lies outside the TTL window and sign it
	// with the same MAC: expiry must be enforced on the timestamp, proving
	// VerifyState does not only check that the signature matches.
	old := time.Now().Add(-2 * stateTTL).UnixMilli()
	payload := "google:" + strconv.FormatInt(old, 10) + ":nonce"
	state := base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(svc.stateMAC(payload))
	if err := svc.VerifyState(state, "google"); err == nil {
		t.Fatal("expected error for an expired state token")
	}
}

func TestVerifyStateIsSingleUse(t *testing.T) {
	svc := newTestService()
	state, err := svc.BuildState("google")
	if err != nil {
		t.Fatalf("BuildState: %v", err)
	}
	if err := svc.VerifyState(state, "google"); err != nil {
		t.Fatalf("first verify should pass: %v", err)
	}
	if err := svc.VerifyState(state, "google"); err == nil {
		t.Fatal("second verify of the same token must be rejected")
	}
}

func TestBuildStateIsUnique(t *testing.T) {
	svc := newTestService()
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		state, err := svc.BuildState("google")
		if err != nil {
			t.Fatalf("BuildState: %v", err)
		}
		if seen[state] {
			t.Fatal("two BuildState calls produced the same token")
		}
		seen[state] = true
	}
}

func TestGoogleAuthorizeURLCarriesState(t *testing.T) {
	p := NewGoogleProvider("client-id", "client-secret", "https://api.example.com/oauth/callback")
	url := p.AuthorizeURL("abc123")
	if !strings.HasPrefix(url, googleAuthURL) {
		t.Fatalf("unexpected authorize URL %q", url)
	}
	if !strings.Contains(url, "state=abc123") {
		t.Fatalf("authorize URL must carry the state: %q", url)
	}
	if !strings.Contains(url, "redirect_uri=") {
		t.Fatalf("authorize URL must carry the redirect URI: %q", url)
	}
}

func TestProvidersListAndLookup(t *testing.T) {
	svc := NewService(testStateSecret, NewGoogleProvider("c", "s", "https://api.example.com/cb"))
	list := svc.Providers()
	if len(list) != 1 || list[0].Name != "google" || list[0].Label != "Google" {
		t.Fatalf("unexpected providers %+v", list)
	}
	p, ok := svc.Provider("google")
	if !ok || p == nil {
		t.Fatal("google provider should resolve")
	}
	if _, ok := svc.Provider("missing"); ok {
		t.Fatal("unknown provider must not resolve")
	}
}

func TestExchangeCodeFailsOnTransportError(t *testing.T) {
	// A provider pointed at an unreachable endpoint must surface a clean 500
	// instead of leaking a transport-level error to the client.
	p := NewGoogleProvider("c", "s", "https://127.0.0.1:1/cb")
	p.client = &http.Client{Timeout: 200 * time.Millisecond}
	_, err := p.ExchangeCode(t.Context(), "code")
	if err == nil {
		t.Fatal("expected an error for an unreachable token endpoint")
	}
	var httpErr *httputil.HttpError
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusInternalServerError {
		t.Fatalf("expected a 500 httputil error, got %v", err)
	}
}
