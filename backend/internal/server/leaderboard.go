package server

import (
	"net/http"
	"strconv"
	"time"

	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/leaderboard"
	"mma-guessr/backend/internal/middleware"
)

// handleLeaderboard returns ranked players for a mode/period.
func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "classic"
	}
	if !contains(games.GameModes, mode) {
		httputil.WriteError(w, http.StatusBadRequest, "无效的游戏模式")
		return
	}
	period := r.URL.Query().Get("period")
	if period == "" {
		period = "overall"
	}
	if !contains(leaderboard.Periods, period) {
		httputil.WriteError(w, http.StatusBadRequest, "无效的周期")
		return
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			httputil.WriteError(w, http.StatusBadRequest, "limit 需为 1-50 的整数")
			return
		}
		limit = parsed
	}
	var date *string
	if raw := r.URL.Query().Get("date"); raw != "" {
		if !validDate(raw) {
			httputil.WriteError(w, http.StatusBadRequest, "date 需为 YYYY-MM-DD")
			return
		}
		date = &raw
	}

	entries, err := s.services.Leaderboard.GetRankings(leaderboard.Query{
		Period: period, Mode: mode, Limit: limit, Date: date,
	})
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if entries == nil {
		entries = []leaderboard.Entry{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"period":  period,
		"mode":    mode,
		"date":    date,
		"entries": entries,
	})
}

func validDate(value string) bool {
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}

// handleProfile returns the caller's aggregated stats.
func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())

	username, err := s.usernameFor(identity.Role, identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	stats, err := s.services.Profile.GetAggregation(identity.Role, identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"username": username,
		"role":     identity.Role,
		"stats":    stats,
	})
}

func (s *Server) usernameFor(role, subject string) (string, error) {
	if role == "guest" {
		guest, err := s.services.Auth.GuestProfile(subject)
		if err != nil {
			return "", err
		}
		if guest != nil {
			return guest.Username, nil
		}
		return "游客_" + truncate4(subject), nil
	}
	user, err := s.services.Auth.UserProfile(subject)
	if err != nil {
		return "", err
	}
	return user.Username, nil
}

func truncate4(value string) string {
	if len(value) >= 4 {
		return value[:4]
	}
	return value
}
