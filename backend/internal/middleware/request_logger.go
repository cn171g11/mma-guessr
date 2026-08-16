package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

// RequestLogger logs each request method, path, status and duration. Wrapped
// response writer captures the status code written by handlers.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// RequestLogger logs each request at an appropriate level based on status.
func RequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			duration := time.Since(start)
			attrs := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", duration.Milliseconds(),
			}
			switch {
			case rec.status >= 500:
				logger.Error("request failed", attrs...)
			case rec.status >= 400:
				logger.Warn("request warning", attrs...)
			default:
				logger.Info("request", attrs...)
			}
		})
	}
}
