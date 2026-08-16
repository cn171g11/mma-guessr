package middleware

import (
	"errors"
	"log/slog"
	"net/http"

	"mma-guessr/backend/internal/httputil"
)

// ErrorHandler converts panics and errors into client-safe responses. Only
// *httputil.HttpError messages leak; everything else returns a generic 500.
func ErrorHandler(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("panic recovered", "method", r.Method, "path", r.URL.Path, "panic", rec)
				httputil.WriteError(w, http.StatusInternalServerError, "Internal Server Error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// NotFound returns a generic 404 and never echoes the requested URL.
func NotFound(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteError(w, http.StatusNotFound, "Not Found")
}

// AsHttpError unwraps an error into an HttpError, or returns a generic 500.
func AsHttpError(err error) *httputil.HttpError {
	var httpErr *httputil.HttpError
	if errors.As(err, &httpErr) {
		return httpErr
	}
	return httputil.New(http.StatusInternalServerError, "Internal Server Error")
}
