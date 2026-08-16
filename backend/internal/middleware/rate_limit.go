package middleware

import (
	"net/http"
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

// ClientIP returns the client IP from the remote address. When the service
// runs behind a trusted proxy, the caller should populate X-Forwarded-For.
func ClientIP(r *http.Request) string {
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
