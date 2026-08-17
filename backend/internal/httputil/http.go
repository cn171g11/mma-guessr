package httputil

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sync/atomic"
)

// Payload padding spans (in bytes). Padding adds 16 to 16+32-1 bytes of
// random data, then base64url encoding widens it further.
const (
	paddingMinBytes  = 16
	paddingSpanBytes = 32
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

// payloadPadding controls response payload randomization (network hardening,
// Section 10.3 of the security-check skill). Set via EnablePayloadPadding at
// startup; read concurrently afterwards.
var payloadPadding atomic.Bool

// EnablePayloadPadding toggles random padding on JSON object responses so
// traffic length analysis cannot fingerprint exact API payload shapes.
func EnablePayloadPadding(on bool) {
	payloadPadding.Store(on)
}

// WriteJSON writes v as a JSON response with the given status code. When
// payload padding is enabled, map responses gain a random _pad field; array,
// string and nil payloads are left untouched to keep their contracts stable.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	if payloadPadding.Load() {
		v = padPayload(v)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// padPayload injects a random-length _pad field into a shallow copy of the
// object, never mutating the caller's map.
func padPayload(v any) any {
	m, ok := v.(map[string]any)
	if !ok {
		return v
	}
	padded := make(map[string]any, len(m)+1)
	for key, value := range m {
		padded[key] = value
	}
	padded["_pad"] = randomPad()
	return padded
}

// randomPad returns a random base64url string of 16-47 bytes, obscuring the
// payload's true length. The span comes from crypto/rand so the length is
// unpredictable even though the padding itself is not secret.
func randomPad() string {
	span := make([]byte, 1)
	if _, err := rand.Read(span); err != nil {
		return ""
	}
	length := paddingMinBytes + int(span[0])%paddingSpanBytes
	raw := make([]byte, length)
	if _, err := rand.Read(raw); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// WriteError writes a standard error envelope {error: message}.
func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}
