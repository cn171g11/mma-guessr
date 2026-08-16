package util

import (
	"crypto/rand"
	"encoding/hex"
)

// NewUUID returns a random UUID v4 string without dashes, used as a stable
// text primary key across users, guests and refresh tokens.
func NewUUID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
	buf[8] = (buf[8] & 0x3f) | 0x80 // variant 10
	return hex.EncodeToString(buf)
}
