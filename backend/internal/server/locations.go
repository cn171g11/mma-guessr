package server

import (
	"net/http"
	"strconv"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/middleware"
)

// handleLocationsRandom draws random question-bank locations.
func (s *Server) handleLocationsRandom(w http.ResponseWriter, r *http.Request) {
	query := locations.RandomLocationsQuery{Count: 1}

	if raw := r.URL.Query().Get("region"); raw != "" {
		if !contains(locations.LocationRegions, raw) {
			httputil.WriteError(w, http.StatusBadRequest, "无效的区域")
			return
		}
		query.Region = &raw
	}
	if raw := r.URL.Query().Get("difficulty"); raw != "" {
		difficulty, err := strconv.Atoi(raw)
		if err != nil || difficulty < 1 || difficulty > 5 {
			httputil.WriteError(w, http.StatusBadRequest, "难度需在 1-5 之间")
			return
		}
		query.Difficulty = &difficulty
	}
	if raw := r.URL.Query().Get("source"); raw != "" {
		if !contains(locations.LocationSources, raw) {
			httputil.WriteError(w, http.StatusBadRequest, "无效的数据源")
			return
		}
		query.Source = &raw
	}
	if raw := r.URL.Query().Get("count"); raw != "" {
		count, err := strconv.Atoi(raw)
		if err != nil || count < 1 || count > 20 {
			httputil.WriteError(w, http.StatusBadRequest, "count 需为 1-20 的整数")
			return
		}
		query.Count = count
	}

	drawn, err := s.services.Locations.GetRandomLocations(query)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if drawn == nil {
		drawn = []locations.LocationRecord{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"locations": drawn})
}

// handleLocationsStats returns cached per-region counts.
func (s *Server) handleLocationsStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.services.Locations.GetLocationStats()
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, stats)
}

// handleDailyToday returns today's challenge for the caller.
func (s *Server) handleDailyToday(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	challenge, err := s.services.Daily.GetToday(identity.Role, identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, challenge)
}
