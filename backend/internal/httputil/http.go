package httputil

import (
	"encoding/json"
	"net/http"
)

// HttpError is an error with an associated HTTP status code. Only these
// errors leak their message to the client; everything else is masked.
type HttpError struct {
	Status  int
	Message string
}

// MaxBodyBytes caps the size of accepted JSON request bodies (1MB).
const MaxBodyBytes = 1 << 20

func (e *HttpError) Error() string {
	return e.Message
}

// New creates an HttpError with the given status and client-safe message.
func New(status int, message string) *HttpError {
	return &HttpError{Status: status, Message: message}
}

// BadRequest returns a 400 HttpError.
func BadRequest(message string) *HttpError {
	return New(http.StatusBadRequest, message)
}

// Unauthorized returns a 401 HttpError.
func Unauthorized(message string) *HttpError {
	return New(http.StatusUnauthorized, message)
}

// Forbidden returns a 403 HttpError.
func Forbidden(message string) *HttpError {
	return New(http.StatusForbidden, message)
}

// NotFound returns a 404 HttpError.
func NotFound(message string) *HttpError {
	return New(http.StatusNotFound, message)
}

// Conflict returns a 409 HttpError.
func Conflict(message string) *HttpError {
	return New(http.StatusConflict, message)
}

// TooManyRequests returns a 429 HttpError.
func TooManyRequests(message string) *HttpError {
	return New(http.StatusTooManyRequests, message)
}

// ServiceUnavailable returns a 503 HttpError.
func ServiceUnavailable(message string) *HttpError {
	return New(http.StatusServiceUnavailable, message)
}

// WriteJSON writes v as a JSON response with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a standard error envelope {error: message}.
func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}
