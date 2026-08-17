package server

import (
	"net/http"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/oauth"
)

// oauthQueryParam is the URL parameter appended to the frontend redirect so
// the page can show a one-time login result toast.
const oauthQueryParam = "oauth"

// handleOAuthProviders lists the configured third-party providers. When no
// provider is configured the list is empty so the login panel hides the
// third-party button.
func (s *Server) handleOAuthProviders(w http.ResponseWriter, _ *http.Request) {
	providers := []oauth.ProviderInfo{}
	if s.services.OAuth != nil {
		providers = s.services.OAuth.Providers()
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"providers": providers})
}

// handleOAuthAuthorize starts the authorization-code flow: it signs a state
// token (login CSRF / replay protection) and redirects to the provider's
// consent page. The response is a plain browser redirect, hence no request
// signing is required (the path is excluded from the signature middleware).
func (s *Server) handleOAuthAuthorize(w http.ResponseWriter, r *http.Request) {
	provider, ok := s.oauthProvider(r.PathValue("provider"))
	if !ok {
		httputil.WriteError(w, http.StatusNotFound, "不支持的第三方登录方式")
		return
	}
	state, err := s.services.OAuth.BuildState(provider.Name())
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	// The redirect target is the provider's fixed consent URL built from
	// configuration; state is only a query parameter, never a URL, so the
	// host cannot be influenced by user input.
	http.Redirect(w, r, provider.AuthorizeURL(state), http.StatusFound) // #nosec G710 -- fixed provider URL
}

// handleOAuthCallback completes the flow: it verifies the signed state,
// exchanges the authorization code for the provider identity, links or logs
// in the account and attaches the refresh cookie. The user lands back on the
// frontend, which restores the session via the HttpOnly refresh cookie.
func (s *Server) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	providerName := r.PathValue("provider")
	provider, ok := s.oauthProvider(providerName)
	if !ok {
		httputil.WriteError(w, http.StatusNotFound, "不支持的第三方登录方式")
		return
	}
	if err := s.services.OAuth.VerifyState(r.URL.Query().Get("state"), providerName); err != nil {
		s.redirectOAuthFailed(w, r)
		return
	}
	identity, err := provider.ExchangeCode(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		s.redirectOAuthFailed(w, r)
		return
	}
	user, err := s.services.Auth.LinkOAuthUser(providerName, identity.ProviderID, identity.Email, identity.Name)
	if err != nil {
		s.redirectOAuthFailed(w, r)
		return
	}
	pair, err := s.services.Auth.IssueTokenPair(user.ID)
	if err != nil {
		s.redirectOAuthFailed(w, r)
		return
	}
	s.setRefreshCookie(w, pair.RefreshToken)
	http.Redirect(w, r, s.cfg.FrontendOrigin+"/?"+oauthQueryParam+"=success", http.StatusFound)
}

// oauthProvider resolves the provider by name, tolerating an unconfigured
// OAuth service so the endpoints degrade to a clean 404.
func (s *Server) oauthProvider(name string) (oauth.Provider, bool) {
	if s.services.OAuth == nil {
		return nil, false
	}
	return s.services.OAuth.Provider(name)
}

// redirectOAuthFailed bounces the browser back to the frontend with a
// machine-readable failure marker; details are not exposed to the client.
func (s *Server) redirectOAuthFailed(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, s.cfg.FrontendOrigin+"/?"+oauthQueryParam+"=failed", http.StatusFound)
}
