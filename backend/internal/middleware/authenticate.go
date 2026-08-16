package middleware

import (
	"context"
	"net/http"
	"strings"

	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/httputil"
)

type identityKey struct{}

// Identity represents the authenticated caller for a request.
type Identity struct {
	Role    string
	Subject string // user ID or guest ID
}

// WithIdentity stores the request identity in the context.
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// IdentityFrom extracts the identity from the request context.
func IdentityFrom(ctx context.Context) (*Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(*Identity)
	return id, ok
}

// BearerToken extracts the Bearer token from the Authorization header.
func BearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if strings.HasPrefix(header, prefix) {
		return strings.TrimPrefix(header, prefix)
	}
	return ""
}

// RequireAuth verifies a Bearer access token (user or guest) and stores the
// identity in context.
func RequireAuth(tokens *auth.TokenService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := BearerToken(r)
			if token == "" {
				httputil.WriteError(w, http.StatusUnauthorized, "请先登录")
				return
			}
			claims, err := tokens.VerifyAccessToken(token)
			if err != nil {
				httputil.WriteError(w, http.StatusUnauthorized, "请先登录")
				return
			}
			r = r.WithContext(WithIdentity(r.Context(), &Identity{
				Role:    claims.Role,
				Subject: claims.Subject,
			}))
			next.ServeHTTP(w, r)
		})
	}
}

// RequireRegisteredUser additionally rejects guest identities.
func RequireRegisteredUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := IdentityFrom(r.Context())
		if !ok || id.Role != auth.RoleUser {
			httputil.WriteError(w, http.StatusForbidden, "需要注册用户")
			return
		}
		next.ServeHTTP(w, r)
	})
}
