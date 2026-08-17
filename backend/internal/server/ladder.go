package server

import (
	"net/http"
	"strconv"

	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
)

// handleRatings returns the caller's ladder snapshot plus the top ranked users.
func (s *Server) handleRatings(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	view, err := s.services.Ratings.Get(identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	leaderboard, err := s.services.Ratings.Leaderboard(50)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"rating": view, "leaderboard": leaderboard})
}

// handleProfileCollections returns the locations the player identified.
func (s *Server) handleProfileCollections(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	items, err := s.services.Profile.Collections(identity.Role, identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	total := len(items)
	if total > 200 {
		items = items[:200]
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"total": total, "items": items})
}

// handleDailyLeaderboard returns the top daily scores for a date.
func (s *Server) handleDailyLeaderboard(w http.ResponseWriter, r *http.Request) {
	entries, err := s.services.Daily.Leaderboard(r.URL.Query().Get("date"), 20)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

// handleGamesGet returns a single game with full round coordinates for replay.
func (s *Server) handleGamesGet(w http.ResponseWriter, r *http.Request) {
	raw := r.PathValue("gameId")
	gameID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || gameID < 1 {
		httputil.WriteError(w, http.StatusBadRequest, "gameId 必须为正整数")
		return
	}
	identity, _ := middleware.IdentityFrom(r.Context())
	game, err := s.services.Games.GetGame(games.PlayerRef{Role: identity.Role, ID: identity.Subject}, gameID)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if game == nil {
		httputil.WriteError(w, http.StatusNotFound, "对局不存在")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"game": game})
}

// handleLocationFact returns a fact for a location by name.
func (s *Server) handleLocationFact(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	fact, err := s.services.Facts.GetFact(name)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"name": name, "fact": fact})
}