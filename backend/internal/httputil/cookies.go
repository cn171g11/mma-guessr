package httputil

import (
	"net/http"
	"net/url"
	"strings"
	"time"
)

// RefreshCookieName matches the frontend's HttpOnly refresh cookie.
const RefreshCookieName = "mma_refresh"

// RefreshCookieFromRequest extracts and URL-decodes the refresh token cookie.
func RefreshCookieFromRequest(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(RefreshCookieName)
	if err != nil {
		return "", false
	}
	decoded, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		return "", false
	}
	return decoded, true
}

// SetRefreshCookie writes the HttpOnly refresh cookie. Secure is only enabled
// in production, mirroring the previous behavior.
func SetRefreshCookie(w http.ResponseWriter, token string, ttlSeconds int, secure bool, sameSite string) {
	value := url.QueryEscape(token)
	cookie := &http.Cookie{ // #nosec G124 -- HttpOnly set; Secure/SameSite are caller-controlled (off in dev/HTTP)
		Name:     RefreshCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		MaxAge:   ttlSeconds,
	}
	switch strings.ToLower(sameSite) {
	case "strict":
		cookie.SameSite = http.SameSiteStrictMode
	case "none":
		cookie.SameSite = http.SameSiteNoneMode
	default:
		cookie.SameSite = http.SameSiteLaxMode
	}
	http.SetCookie(w, cookie)
}

// ClearRefreshCookie expires the refresh cookie.
func ClearRefreshCookie(w http.ResponseWriter) {
	// #nosec G124 -- clearing cookie; Secure/SameSite are irrelevant on expiry.
	http.SetCookie(w, &http.Cookie{
		Name:     RefreshCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
}
