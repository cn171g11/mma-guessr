package middleware

import (
	"net/http"
	"strings"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/ratelimit"
)

// RateLimit applies a sliding-window limit keyed by client IP (or a custom
// identity function). Responses over the limit get 429.
func RateLimit(prefix string, window time.Duration, limit int, identity func(*http.Request) string) func(http.Handler) http.Handler {
	limiter := ratelimit.NewSlidingWindow(window, limit)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := prefix + ":" + ClientIP(r)
			if identity != nil {
				key = prefix + ":" + identity(r)
			}
			if !limiter.Allow(key) {
				httputil.WriteError(w, http.StatusTooManyRequests, "请求过于频繁, 请稍后再试")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// trustProxy mirrors Express' trust-proxy behavior: when enabled, ClientIP
// resolves the real client from the leftmost X-Forwarded-For entry so rate
// limits apply per real client behind a reverse proxy instead of the proxy IP.
var trustProxy bool

// ConfigureTrustProxy enables X-Forwarded-For resolution for ClientIP. It must
// be called once at startup from the TRUST_PROXY configuration. Leaving it
// disabled keeps the direct-connection default so a client cannot spoof the
// header to bypass per-IP limits.
func ConfigureTrustProxy(enabled bool) {
	trustProxy = enabled
}

// ClientIP returns the client IP. When the service runs behind a trusted
// reverse proxy, the leftmost X-Forwarded-For entry is used (mirroring
// Express with one trust hop); otherwise the TCP remote address is used
// unchanged.
func ClientIP(r *http.Request) string {
	if trustProxy {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			if first := strings.TrimSpace(strings.Split(forwarded, ",")[0]); first != "" {
				return first
			}
		}
	}
	host := r.RemoteAddr
	if i := lastColonIndex(host); i >= 0 {
		host = host[:i]
	}
	return host
}

func lastColonIndex(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == ':' {
			return i
		}
	}
	return -1
}
