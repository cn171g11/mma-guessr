package middleware

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/signature"
)

// MaxBodyBytes caps request body size (mirrors the previous 1MB limit).
const MaxBodyBytes = 1 << 20

type bodyKey struct{}

var noncePattern = regexp.MustCompile(`^[0-9A-Za-z-]{16,64}$`)

// WithRawBody stores the captured request body into the request context.
func WithRawBody(ctx context.Context, body []byte) context.Context {
	return context.WithValue(ctx, bodyKey{}, body)
}

// RawBody retrieves the captured request body from the context.
func RawBody(ctx context.Context) []byte {
	if v, ok := ctx.Value(bodyKey{}).([]byte); ok {
		return v
	}
	return nil
}

// signatureEnforcer verifies HMAC request signing when a secret is configured.
// It is skipped for health, metrics and proxy routes. When no secret is set
// the middleware is a no-op pass-through.
type signatureEnforcer struct {
	secret string
	conn   *sql.DB
}

// NewAPISignature creates the request-signing middleware.
func NewAPISignature(secret string, conn *sql.DB) func(http.Handler) http.Handler {
	enforcer := &signatureEnforcer{secret: secret, conn: conn}
	return enforcer.handle
}

func (s *signatureEnforcer) handle(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.secret == "" || isSignatureSkipped(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		// Read and re-inject the raw body (bounded) for downstream handlers.
		body, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
		if err != nil {
			httputil.WriteError(w, http.StatusBadRequest, "读取请求体失败")
			return
		}
		if len(body) > MaxBodyBytes {
			httputil.WriteError(w, http.StatusRequestEntityTooLarge, "请求体过大")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		r = r.WithContext(WithRawBody(r.Context(), body))

		timestamp := r.Header.Get("x-request-timestamp")
		nonce := r.Header.Get("x-request-nonce")
		expectedSig := r.Header.Get("x-request-signature")

		if err := s.verify(r, body, timestamp, nonce, expectedSig); err != nil {
			httputil.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *signatureEnforcer) verify(r *http.Request, body []byte, timestamp, nonce, expected string) error {
	if timestamp == "" || nonce == "" || expected == "" {
		return httputil.BadRequest("缺少签名头")
	}
	if !noncePattern.MatchString(nonce) {
		return httputil.BadRequest("nonce 格式非法")
	}

	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return httputil.BadRequest("时间戳格式非法")
	}
	const skewWindow = 5 * 60 * 1000
	if now := time.Now().UnixMilli(); now-ts > skewWindow || ts-now > skewWindow {
		return httputil.BadRequest("请求已过期")
	}

	bodyHash := signature.SHA256Hex(body)
	computed := signature.ComputeHMAC(s.secret, timestamp, nonce, r.Method, r.URL.RequestURI(), bodyHash)
	if !signature.ConstantTimeEquals(computed, expected) {
		return httputil.BadRequest("签名校验失败")
	}

	if err := s.consumeNonce(nonce); err != nil {
		return err
	}
	return nil
}

// consumeNonce records the nonce atomically and rejects a replay. INSERT OR
// IGNORE is race-free: a second concurrent request with the same nonce finds
// the primary key already taken (RowsAffected == 0) and is rejected cleanly.
func (s *signatureEnforcer) consumeNonce(nonce string) error {
	expiresAt := time.Now().UTC().Add(2 * time.Minute).Format(time.RFC3339)
	res, err := s.conn.Exec("INSERT OR IGNORE INTO nonces (nonce, expires_at) VALUES (?, ?)", nonce, expiresAt)
	if err != nil {
		return httputil.New(http.StatusServiceUnavailable, "nonce 校验失败")
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		return httputil.BadRequest("nonce 已使用")
	}
	return nil
}

func isSignatureSkipped(path string) bool {
	return path == "/api/health" || path == "/api/metrics" || isProxyPath(path) ||
		path == "/socket.io" || path == "/socket.io/" || isOAuthRedirectPath(path)
}

// isOAuthRedirectPath reports whether the path is part of the OAuth browser
// flow. The authorize/callback steps are plain browser navigations (302s) and
// cannot carry HMAC headers, so they bypass request signing; the state token
// provides the replay protection instead.
func isOAuthRedirectPath(path string) bool {
	const (
		authorizePrefix = "/api/oauth/authorize/"
		callbackPrefix  = "/api/oauth/callback/"
	)
	return strings.HasPrefix(path, authorizePrefix) || strings.HasPrefix(path, callbackPrefix)
}

func isProxyPath(path string) bool {
	const proxyPrefix = "/api/proxy/"
	return len(path) >= len(proxyPrefix) && path[:len(proxyPrefix)] == proxyPrefix
}
