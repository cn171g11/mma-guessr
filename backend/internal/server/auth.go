package server

import (
	"net/http"

	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/config"
	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
)

type verificationCodeRequest struct {
	Email string `json:"email"`
}

type registerRequest struct {
	Username   string `json:"username"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	GuestToken string `json:"guestToken"`
}

type bindRequest struct {
	Username   string `json:"username"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	GuestToken string `json:"guestToken"`
}

type loginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

type tokenRequest struct {
	RefreshToken string `json:"refreshToken"`
}

// handleVerificationCode issues a verification code. Registered and
// unregistered emails both receive 200 to prevent account enumeration.
func (s *Server) handleVerificationCode(w http.ResponseWriter, r *http.Request) {
	var req verificationCodeRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	email := auth.NormalizeEmail(req.Email)
	if !auth.IsValidEmail(email) {
		httputil.WriteError(w, http.StatusBadRequest, "邮箱格式不正确")
		return
	}
	if err := s.services.Auth.SendVerificationCode(email); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"message": "验证码已发送"})
}

// resolveGuestID validates a guest token and returns the guest subject,
// mirroring resolveGuestKey in the previous backend.
func (s *Server) resolveGuestID(w http.ResponseWriter, guestToken string) (string, bool) {
	claims, err := s.services.Tokens.VerifyAccessToken(guestToken)
	if err != nil {
		httputil.WriteError(w, http.StatusUnauthorized, "访问令牌无效")
		return "", false
	}
	if claims.Role != auth.RoleGuest {
		httputil.WriteError(w, http.StatusBadRequest, "提供的不是游客令牌")
		return "", false
	}
	return claims.Subject, true
}

// handleRegister creates an account, optionally binding a guest session.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	email := auth.NormalizeEmail(req.Email)
	if !auth.IsValidEmail(email) {
		httputil.WriteError(w, http.StatusBadRequest, "邮箱格式不正确")
		return
	}
	registered, err := s.services.Auth.IsEmailRegistered(email)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if registered {
		httputil.WriteError(w, http.StatusConflict, "该邮箱已被注册")
		return
	}

	var guestID *string
	if req.GuestToken != "" {
		id, ok := s.resolveGuestID(w, req.GuestToken)
		if !ok {
			return
		}
		guestID = &id
	}

	session, err := s.services.Auth.RegisterAccount(req.Username, email, req.Password, guestID)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	s.respondAccountSession(w, http.StatusCreated, session)
}

// handleBind registers a new account bound to an existing guest session.
func (s *Server) handleBind(w http.ResponseWriter, r *http.Request) {
	var req bindRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	if req.GuestToken == "" {
		httputil.WriteError(w, http.StatusBadRequest, "游客令牌不能为空")
		return
	}
	email := auth.NormalizeEmail(req.Email)
	if !auth.IsValidEmail(email) {
		httputil.WriteError(w, http.StatusBadRequest, "邮箱格式不正确")
		return
	}
	registered, err := s.services.Auth.IsEmailRegistered(email)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if registered {
		httputil.WriteError(w, http.StatusConflict, "该邮箱已被注册")
		return
	}

	guestID, ok := s.resolveGuestID(w, req.GuestToken)
	if !ok {
		return
	}

	session, err := s.services.Auth.RegisterAccount(req.Username, email, req.Password, &guestID)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	s.respondAccountSession(w, http.StatusCreated, session)
}

// handleLogin authenticates with identifier (email or username) + password.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	if err := auth.ValidateLogin(req.Identifier, req.Password); err != nil {
		httputil.WriteError(w, err.Status, err.Message)
		return
	}
	session, err := s.services.Auth.LoginAccount(req.Identifier, req.Password)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	s.respondAccountSession(w, http.StatusOK, session)
}

// handleRefresh rotates the refresh token from the cookie or request body.
func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	submitted, ok := httputil.RefreshCookieFromRequest(r)
	if !ok {
		if req.RefreshToken == "" {
			httputil.WriteError(w, http.StatusBadRequest, "缺少刷新令牌")
			return
		}
		submitted = req.RefreshToken
	}

	pair, err := s.services.Auth.ExchangeRefreshToken(submitted)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	s.respondTokenPair(w, http.StatusOK, pair)
}

// handleLogout revokes the refresh token and clears the cookie.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	identity, ok := middleware.IdentityFrom(r.Context())
	if !ok {
		httputil.WriteError(w, http.StatusBadRequest, "缺少身份信息")
		return
	}
	if err := s.services.Auth.RevokeTokens(identity.Subject); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.ClearRefreshCookie(w)
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"message": "已注销"})
}

// handleGuest creates a guest session.
func (s *Server) handleGuest(w http.ResponseWriter, _ *http.Request) {
	session, err := s.services.Auth.CreateGuest()
	if err != nil {
		s.writeServiceError(w, nil, err)
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, session)
}

// handleMe returns the caller's profile and progress.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	identity, ok := middleware.IdentityFrom(r.Context())
	if !ok {
		httputil.WriteError(w, http.StatusBadRequest, "缺少身份信息")
		return
	}
	profile, err := s.services.Auth.Me(identity.Role, identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, profile)
}

// respondAccountSession attaches the refresh cookie and returns only the
// short-lived access token in the body.
func (s *Server) respondAccountSession(w http.ResponseWriter, status int, session *auth.AccountSession) {
	s.setRefreshCookie(w, session.TokenPair.RefreshToken)
	httputil.WriteJSON(w, status, map[string]any{
		"user": session.User,
		"tokenPair": map[string]string{
			"accessToken": session.TokenPair.AccessToken,
		},
	})
}

// respondTokenPair attaches the refresh cookie and returns only the access
// token in the body.
func (s *Server) respondTokenPair(w http.ResponseWriter, status int, pair *auth.TokenPair) {
	s.setRefreshCookie(w, pair.RefreshToken)
	httputil.WriteJSON(w, status, map[string]any{
		"tokenPair": map[string]string{
			"accessToken": pair.AccessToken,
		},
	})
}

func (s *Server) setRefreshCookie(w http.ResponseWriter, token string) {
	httputil.SetRefreshCookie(w, token, config.AppConstants.RefreshTTLSeconds, s.cfg.IsProduction(), s.cfg.CookieSameSite)
}

func (s *Server) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	httpErr := middleware.AsHttpError(err)
	if httpErr.Status >= 500 && r != nil {
		s.logger.Error("auth service error", "method", r.Method, "path", r.URL.Path, "error", err)
	}
	httputil.WriteError(w, httpErr.Status, httpErr.Message)
}
