package server

import (
	"net/http"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
)

type titleRequest struct {
	Title *string `json:"title"`
}

// handleAchievements returns the full achievement list with unlock states.
func (s *Server) handleAchievements(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	if identity.Role != "user" {
		httputil.WriteError(w, http.StatusBadRequest, "成就系统仅对注册用户开放，请先登录")
		return
	}
	payload, err := s.services.Achievements.GetAchievements(identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, payload)
}

// handleAchievementsPutTitle equips or clears a title.
func (s *Server) handleAchievementsPutTitle(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	if identity.Role != "user" {
		httputil.WriteError(w, http.StatusBadRequest, "成就系统仅对注册用户开放，请先登录")
		return
	}
	var req titleRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	if req.Title != nil && len(*req.Title) > 40 {
		httputil.WriteError(w, http.StatusBadRequest, "称号过长")
		return
	}
	equipped, err := s.services.Achievements.EquipTitle(identity.Subject, req.Title)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"equippedTitle": equipped})
}

// handleAchievementsDeleteTitle clears the equipped title.
func (s *Server) handleAchievementsDeleteTitle(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	if identity.Role != "user" {
		httputil.WriteError(w, http.StatusBadRequest, "成就系统仅对注册用户开放，请先登录")
		return
	}
	equipped, err := s.services.Achievements.EquipTitle(identity.Subject, nil)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"equippedTitle": equipped})
}
