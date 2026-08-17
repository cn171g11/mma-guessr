package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testAccess  = "test-access-secret-0123456789abcdef"
	testRefresh = "test-refresh-secret-0123456789abcdef"
)

func newTestTokenService() *TokenService {
	return NewTokenService(testAccess, testRefresh, 15*time.Minute, 30*24*time.Hour, 7*24*time.Hour)
}

func TestSignAndVerifyAccessToken(t *testing.T) {
	svc := newTestTokenService()
	token, err := svc.SignAccessToken("user-1", RoleUser)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	claims, err := svc.VerifyAccessToken(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user-1" || claims.Role != RoleUser {
		t.Fatalf("unexpected claims %+v", claims)
	}
	if claims.Issuer != tokenIssuer {
		t.Fatalf("issuer must be %q, got %q", tokenIssuer, claims.Issuer)
	}
	if !hasAudience(claims.Audience, accessAudience) {
		t.Fatalf("audience must contain %q, got %v", accessAudience, claims.Audience)
	}
}

func TestSignAndVerifyRefreshToken(t *testing.T) {
	svc := newTestTokenService()
	token, err := svc.SignRefreshToken("user-1")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	claims, err := svc.VerifyRefreshToken(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user-1" || claims.Type != "refresh" {
		t.Fatalf("unexpected claims %+v", claims)
	}
	if !hasAudience(claims.Audience, refreshAudience) {
		t.Fatalf("audience must contain %q, got %v", refreshAudience, claims.Audience)
	}
}

func TestVerifyRejectsWrongAudience(t *testing.T) {
	svc := newTestTokenService()
	token, err := svc.SignRefreshToken("user-1")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	// A refresh token must never pass the access verifier (audience split).
	if _, err := svc.VerifyAccessToken(token); err == nil {
		t.Fatal("refresh token must not verify as an access token")
	}
}

func TestVerifyRejectsForgedIssuer(t *testing.T) {
	svc := newTestTokenService()
	// Mint a token with a rogue issuer but a valid signature: issuer check
	// must reject it even though the signature is correct.
	now := time.Now().UTC()
	claims := Claims{
		Role: RoleUser,
		Type: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user-1",
			ID:        "jti",
			Issuer:    "attacker",
			Audience:  jwt.ClaimStrings{accessAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testAccess))
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if _, err := svc.VerifyAccessToken(token); err == nil {
		t.Fatal("token with a foreign issuer must be rejected")
	}
}

func TestVerifyRejectsTamperedToken(t *testing.T) {
	svc := newTestTokenService()
	token, err := svc.SignAccessToken("user-1", RoleUser)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	tampered := token[:len(token)-4] + strings.Repeat("0", 4)
	if _, err := svc.VerifyAccessToken(tampered); err == nil {
		t.Fatal("tampered token must be rejected")
	}
}

// hasAudience reports whether the audience claim list contains the value.
func hasAudience(list jwt.ClaimStrings, want string) bool {
	for _, a := range list {
		if a == want {
			return true
		}
	}
	return false
}
