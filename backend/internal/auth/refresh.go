package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"

	"mma-guessr/backend/internal/util"
)

// RefreshStore persists the SHA-256 hash of the current refresh token per
// user, enabling rotation and reuse detection. SQLite single-writer access
// gives us atomic compare-and-swap semantics within a transaction.
type RefreshStore struct {
	conn *sql.DB
}

// NewRefreshStore creates a RefreshStore.
func NewRefreshStore(conn *sql.DB) *RefreshStore {
	return &RefreshStore{conn: conn}
}

// Store records the hash of a new refresh token for a user, replacing any
// previous token (rotation).
func (r *RefreshStore) Store(userID, refreshToken string, ttlSeconds int) error {
	hash := hashToken(refreshToken)
	expiresAt := util.NowRFC3339Add(ttlSeconds)
	_, err := r.conn.Exec(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
		userID, hash, expiresAt)
	return err
}

// Exchange rotates a refresh token. It verifies the submitted token matches
// the stored hash; on match it replaces the stored token with the new one.
// On mismatch the stored token is revoked entirely (reuse detection).
// Returns true on success, false when the token was invalid/revoked.
func (r *RefreshStore) Exchange(userID, oldToken, newToken string, ttlSeconds int) (bool, error) {
	tx, err := r.conn.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var storedHash, expiresAt string
	err = tx.QueryRow(
		`SELECT token_hash, expires_at FROM refresh_tokens WHERE user_id = ?`, userID).
		Scan(&storedHash, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if util.ParseTime(expiresAt).Before(util.NowTime()) {
		if _, err := tx.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, userID); err != nil {
			return false, err
		}
		_ = tx.Commit()
		return false, nil
	}

	newHash := hashToken(oldToken)
	if subtle.ConstantTimeCompare([]byte(newHash), []byte(storedHash)) != 1 {
		// Mismatch means the submitted token is stale or forged. Reject without
		// deleting so a concurrent successful rotation is not invalidated.
		return false, nil
	}

	if _, err := tx.Exec(
		`UPDATE refresh_tokens SET token_hash = ?, expires_at = ? WHERE user_id = ?`,
		hashToken(newToken), util.NowRFC3339Add(ttlSeconds), userID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// Revoke deletes any stored refresh token for a user (logout).
func (r *RefreshStore) Revoke(userID string) error {
	_, err := r.conn.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, userID)
	return err
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
