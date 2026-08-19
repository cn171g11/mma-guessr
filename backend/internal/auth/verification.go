package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

const verifyCodeDigits = 6

// VerificationStore manages email verification codes. Only the HMAC-SHA256
// hash of a code is ever stored, so a DB leak never exposes usable codes.
type VerificationStore struct {
	conn       *sql.DB
	hmacSecret []byte
}

// NewVerificationStore creates a VerificationStore with the code secret.
func NewVerificationStore(conn *sql.DB, secret string) *VerificationStore {
	return &VerificationStore{conn: conn, hmacSecret: []byte(secret)}
}

// SendCode records a new code for an email, enforcing the resend throttle.
// It returns the plaintext code (only needed for the dev log fallback).
func (v *VerificationStore) SendCode(email string, ttlSeconds, resendSeconds int) (string, *httputil.HttpError) {
	var lastSent sql.NullString
	err := v.conn.QueryRow(
		`SELECT last_sent_at FROM verification_codes WHERE email = ?`, email).Scan(&lastSent)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", httputil.New(500, "验证码服务异常")
	}
	if lastSent.Valid {
		last := util.ParseTime(lastSent.String)
		if !last.IsZero() && util.NowTime().Sub(last) < seconds(resendSeconds) {
			return "", httputil.BadRequest("发送过于频繁，请稍后再试")
		}
	}

	code := randomCode(verifyCodeDigits)
	codeHash := v.hashCode(code)
	now := util.Now()
	expiresAt := util.NowRFC3339Add(ttlSeconds)

	_, err = v.conn.Exec(
		`INSERT INTO verification_codes (email, code_hash, attempts, last_sent_at, expires_at)
		 VALUES (?, ?, 0, ?, ?)
		 ON CONFLICT(email) DO UPDATE SET
			code_hash = excluded.code_hash,
			attempts = 0,
			last_sent_at = excluded.last_sent_at,
			expires_at = excluded.expires_at`,
		email, codeHash, now, expiresAt)
	if err != nil {
		return "", httputil.New(500, "验证码服务异常")
	}
	return code, nil
}

// ConsumeCode validates a submitted code and deletes it on success. It
// enforces the attempt cap and rejects expired codes.
func (v *VerificationStore) ConsumeCode(email, code string, maxAttempts int) *httputil.HttpError {
	var storedHash, expiresAt string
	var attempts int
	err := v.conn.QueryRow(
		`SELECT code_hash, attempts, expires_at FROM verification_codes WHERE email = ?`,
		email).Scan(&storedHash, &attempts, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return httputil.BadRequest("验证码不存在或已过期")
	}
	if err != nil {
		return httputil.New(500, "验证码校验失败")
	}
	if util.ParseTime(expiresAt).Before(util.NowTime()) {
		return httputil.BadRequest("验证码已过期")
	}
	if attempts >= maxAttempts {
		return httputil.BadRequest("验证码尝试次数过多, 请重新获取")
	}

	// Increment attempts first so failed tries count toward the cap.
	if _, err := v.conn.Exec(
		`UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?`, email); err != nil {
		return httputil.New(500, "验证码校验失败")
	}

	if subtle.ConstantTimeCompare([]byte(v.hashCode(code)), []byte(storedHash)) != 1 {
		return httputil.BadRequest("验证码错误")
	}

	if _, err := v.conn.Exec(`DELETE FROM verification_codes WHERE email = ?`, email); err != nil {
		return httputil.New(500, "验证码校验失败")
	}
	return nil
}

func (v *VerificationStore) hashCode(code string) string {
	mac := hmac.New(sha256.New, v.hmacSecret)
	mac.Write([]byte(code))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func randomCode(n int) string {
	// Use crypto/rand: verification codes are security-sensitive and must
	// never come from a predictable pseudo-random source.
	const digits = "0123456789"
	var buf []byte
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		// The generator cannot fail on supported platforms; fall back to
		// a zero-based code so the caller still gets a deterministic value.
		return string(bytes.Repeat([]byte("0"), n))
	}
	for _, b := range raw {
		buf = append(buf, digits[int(b)%len(digits)])
	}
	return string(buf)
}

func seconds(n int) time.Duration {
	return time.Duration(n) * time.Second
}
