package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	RoleUser  = "user"
	RoleGuest = "guest"
)

// Claims are the JWT payload fields issued by the server.
type Claims struct {
	Role string `json:"role"`
	Type string `json:"type"`
	jwt.RegisteredClaims
}

// TokenService issues and verifies access and refresh JWTs.
type TokenService struct {
	accessSecret  []byte
	refreshSecret []byte
	accessTTL     time.Duration
	guestTTL      time.Duration
	refreshTTL    time.Duration
}

// NewTokenService creates a TokenService with the configured secrets.
func NewTokenService(accessSecret, refreshSecret string, accessTTL, guestTTL, refreshTTL time.Duration) *TokenService {
	return &TokenService{
		accessSecret:  []byte(accessSecret),
		refreshSecret: []byte(refreshSecret),
		accessTTL:     accessTTL,
		guestTTL:      guestTTL,
		refreshTTL:    refreshTTL,
	}
}

// SignAccessToken issues an access JWT for a subject with the given role.
func (s *TokenService) SignAccessToken(subject, role string) (string, error) {
	ttl := s.accessTTL
	if role == RoleGuest {
		ttl = s.guestTTL
	}
	now := time.Now().UTC()
	claims := Claims{
		Role: role,
		Type: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   subject,
			ID:        newJTI(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.accessSecret)
}

// SignRefreshToken issues a refresh JWT for a registered user.
func (s *TokenService) SignRefreshToken(userID string) (string, error) {
	now := time.Now().UTC()
	claims := Claims{
		Role: RoleUser,
		Type: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ID:        newJTI(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.refreshTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.refreshSecret)
}

// VerifyAccessToken parses and validates an access JWT, returning its claims.
func (s *TokenService) VerifyAccessToken(token string) (*Claims, error) {
	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return s.accessSecret, nil
	})
	if err != nil || !parsed.Valid {
		return nil, errors.New("invalid access token")
	}
	if claims.Type != "access" {
		return nil, errors.New("wrong token type")
	}
	if claims.Role != RoleUser && claims.Role != RoleGuest {
		return nil, errors.New("invalid role")
	}
	return claims, nil
}

// VerifyRefreshToken parses and validates a refresh JWT, returning its claims.
func (s *TokenService) VerifyRefreshToken(token string) (*Claims, error) {
	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return s.refreshSecret, nil
	})
	if err != nil || !parsed.Valid {
		return nil, errors.New("invalid refresh token")
	}
	if claims.Type != "refresh" || claims.Role != RoleUser {
		return nil, errors.New("wrong token type")
	}
	return claims, nil
}

func newJTI() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return hex.EncodeToString(buf)
}
