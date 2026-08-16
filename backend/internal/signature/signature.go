package signature

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// ComputeHMAC builds the canonical message and returns its hex HMAC-SHA256.
// The message mirrors the frontend's signing scheme exactly:
//
//	timestamp\nnonce\nMETHOD\npath\nbodyHash
//
// where path includes the query string but not the API base.
func ComputeHMAC(secret, timestamp, nonce, method, path, bodyHash string) string {
	message := strings.Join([]string{timestamp, nonce, strings.ToUpper(method), path, bodyHash}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// SHA256Hex returns the lowercase hex SHA-256 digest of data.
func SHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// ConstantTimeEquals compares two strings in constant time to avoid timing
// side channels.
func ConstantTimeEquals(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}
