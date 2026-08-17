package middleware

import (
	"net/http"
	"testing"
)

// configureTrustProxy toggles package state; restore the default after every
// case so the shared flag never leaks between tests.
func withTrustProxy(enabled bool) {
	ConfigureTrustProxy(enabled)
}

func TestClientIPUsesRemoteAddressWhenProxyUntrusted(t *testing.T) {
	withTrustProxy(false)
	req, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.5:5555"
	req.Header.Set("X-Forwarded-For", "203.0.113.9")

	if got := ClientIP(req); got != "10.0.0.5" {
		t.Fatalf("expected TCP remote address, got %q", got)
	}
}

func TestClientIPUsesLeftmostForwardedEntryWhenProxyTrusted(t *testing.T) {
	withTrustProxy(true)
	defer withTrustProxy(false)
	req, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.5:5555"
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.2")

	if got := ClientIP(req); got != "203.0.113.9" {
		t.Fatalf("expected leftmost forwarded IP, got %q", got)
	}
}

func TestClientIPFallsBackToRemoteAddressWhenTrustedButHeaderMissing(t *testing.T) {
	withTrustProxy(true)
	defer withTrustProxy(false)
	req, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.5:5555"

	if got := ClientIP(req); got != "10.0.0.5" {
		t.Fatalf("expected remote address fallback, got %q", got)
	}
}

func TestClientIPIgnoresEmptyForwardedEntryWhenProxyTrusted(t *testing.T) {
	withTrustProxy(true)
	defer withTrustProxy(false)
	req, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.RemoteAddr = "10.0.0.5:5555"
	req.Header.Set("X-Forwarded-For", "   ")

	if got := ClientIP(req); got != "10.0.0.5" {
		t.Fatalf("expected remote address fallback for blank header, got %q", got)
	}
}