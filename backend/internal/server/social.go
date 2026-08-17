package server

import (
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
)

// requireAdmin guards sponsor write endpoints with the sponsor admin token.
// The write endpoints stay locked when no token is configured.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secret := s.cfg.SponsorAdminToken
		if secret == "" {
			httputil.WriteError(w, http.StatusForbidden, "Forbidden")
			return
		}
		const prefix = "Bearer "
		header := r.Header.Get("Authorization")
		if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
			httputil.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		provided := header[len(prefix):]
		if subtle.ConstantTimeCompare([]byte(provided), []byte(secret)) != 1 {
			httputil.WriteError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type friendRequestPayload struct {
	TargetUserId   string `json:"targetUserId"`
	TargetUsername string `json:"targetUsername"`
}

// handleFriendsList returns the user's accepted friendships.
func (s *Server) handleFriendsList(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	friends, err := s.services.Social.ListFriends(identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"friends": friends})
}

// handleFriendsRequests returns incoming and outgoing pending requests.
func (s *Server) handleFriendsRequests(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	incoming, outgoing, err := s.services.Social.ListRequests(identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"incoming": incoming, "outgoing": outgoing})
}

// handleFriendsRequest sends a friendship request to another user.
func (s *Server) handleFriendsRequest(w http.ResponseWriter, r *http.Request) {
	var req friendRequestPayload
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	identity, _ := middleware.IdentityFrom(r.Context())
	target := req.TargetUserId
	if target == "" {
		if req.TargetUsername == "" {
			httputil.WriteError(w, http.StatusBadRequest, "请提供对方用户名")
			return
		}
		var err error
		target, err = s.services.Social.ResolveUserID(req.TargetUsername)
		if err != nil {
			s.writeServiceError(w, r, err)
			return
		}
	}
	if err := s.services.Social.SendRequest(identity.Subject, target); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleFriendsAccept confirms an incoming request.
func (s *Server) handleFriendsAccept(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	if err := s.services.Social.Accept(identity.Subject, r.PathValue("userId")); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleFriendsReject dismisses an incoming request.
func (s *Server) handleFriendsReject(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	if err := s.services.Social.Reject(identity.Subject, r.PathValue("userId")); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleFriendsRemove deletes a friendship.
func (s *Server) handleFriendsRemove(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	if err := s.services.Social.Remove(identity.Subject, r.PathValue("userId")); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleSponsorsList returns the public thank-you list.
func (s *Server) handleSponsorsList(w http.ResponseWriter, _ *http.Request) {
	sponsors, err := s.services.Social.ListSponsors()
	if err != nil {
		s.writeServiceError(w, nil, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"sponsors": sponsors})
}

type sponsorPayload struct {
	Name        string `json:"name"`
	Note        string `json:"note"`
	AmountCents int64  `json:"amountCents"`
	Visible     bool   `json:"visible"`
}

// handleSponsorsAdd records a sponsorship (admin only).
func (s *Server) handleSponsorsAdd(w http.ResponseWriter, r *http.Request) {
	var req sponsorPayload
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	id, err := s.services.Social.AddSponsor(req.Name, req.Note, req.AmountCents, req.Visible)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// handleSponsorsDelete removes a sponsorship (admin only).
func (s *Server) handleSponsorsDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("sponsorId"), 10, 64)
	if err != nil || id < 1 {
		httputil.WriteError(w, http.StatusBadRequest, "sponsorId 必须为正整数")
		return
	}
	if err := s.services.Social.DeleteSponsor(id); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}