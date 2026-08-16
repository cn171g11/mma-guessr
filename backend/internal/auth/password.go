package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

const (
	bcryptCost       = 12
	maxPasswordBytes = 72
)

// HashPassword hashes a plaintext password with bcrypt. It rejects passwords
// longer than 72 bytes (the bcrypt input limit) to avoid silent truncation.
func HashPassword(password string) (string, error) {
	if len(password) > maxPasswordBytes {
		return "", errors.New("密码不能超过 72 字节")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword compares a plaintext password against a bcrypt hash.
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
