package server

import (
	"net/http"
	"regexp"
	"strconv"

	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/middleware"
)

var imageIDPattern = regexp.MustCompile(`^[0-9A-Za-z_-]{1,64}$`)

type gameRoundRequest struct {
	Name       string   `json:"name"`
	LocationID *int64   `json:"locationId"`
	DistanceKm *float64 `json:"distanceKm"`
	Score      int      `json:"score"`
	ImageID    *string  `json:"imageId"`
	Xp         *int     `json:"xp"`
	Difficulty *int     `json:"difficulty"`
	GuessLat   *float64 `json:"guessLat"`
	GuessLng   *float64 `json:"guessLng"`
	AnswerLat  *float64 `json:"answerLat"`
	AnswerLng  *float64 `json:"answerLng"`
}

type gameSubmitRequest struct {
	Mode       string             `json:"mode"`
	Region     *string            `json:"region"`
	TotalScore int                `json:"totalScore"`
	Rounds     []gameRoundRequest `json:"rounds"`
}

// handleGamesSubmit validates and persists a game submission.
func (s *Server) handleGamesSubmit(w http.ResponseWriter, r *http.Request) {
	var req gameSubmitRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	if err := validateGameSubmit(&req); err != nil {
		httputil.WriteError(w, err.Status, err.Message)
		return
	}

	identity, _ := middleware.IdentityFrom(r.Context())
	player := games.PlayerRef{Role: identity.Role, ID: identity.Subject}

	rounds := make([]games.GameRound, 0, len(req.Rounds))
	for _, round := range req.Rounds {
		gameRound := games.GameRound{
			Name:       round.Name,
			LocationID: round.LocationID,
			DistanceKm: round.DistanceKm,
			Score:      round.Score,
			ImageID:    round.ImageID,
			Difficulty: 1,
		}
		if round.Xp != nil {
			gameRound.Xp = *round.Xp
		}
		if round.Difficulty != nil {
			gameRound.Difficulty = *round.Difficulty
		}
		gameRound.GuessLat = round.GuessLat
		gameRound.GuessLng = round.GuessLng
		gameRound.AnswerLat = round.AnswerLat
		gameRound.AnswerLng = round.AnswerLng
		rounds = append(rounds, gameRound)
	}

	game, err := s.services.Games.SubmitGame(player, games.SubmitGameInput{
		Mode:       req.Mode,
		Region:     req.Region,
		TotalScore: req.TotalScore,
		Rounds:     rounds,
	})
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]any{"game": game})
}

func validateGameSubmit(req *gameSubmitRequest) *httputil.HttpError {
	if !contains(games.GameModes, req.Mode) {
		return httputil.BadRequest("无效的游戏模式")
	}
	if req.Region != nil && !contains(locations.LocationRegions, *req.Region) {
		return httputil.BadRequest("无效的区域")
	}
	if req.Mode == "region" {
		if req.Region == nil {
			return httputil.BadRequest("区域模式必须指定 region")
		}
	} else if req.Region != nil {
		return httputil.BadRequest("仅区域模式可携带 region")
	}
	if req.TotalScore < 0 || req.TotalScore > 1_000_000 {
		return httputil.BadRequest("总分超限")
	}
	if len(req.Rounds) < 1 {
		return httputil.BadRequest("至少一轮")
	}
	if len(req.Rounds) > 100 {
		return httputil.BadRequest("回合数超限")
	}
	for _, round := range req.Rounds {
		if err := validateRound(round); err != nil {
			return err
		}
	}
	return nil
}

func validateRound(round gameRoundRequest) *httputil.HttpError {
	if round.Name == "" {
		return httputil.BadRequest("地点名称不能为空")
	}
	if len(round.Name) > 120 {
		return httputil.BadRequest("地点名称过长")
	}
	if round.LocationID != nil && *round.LocationID <= 0 {
		return httputil.BadRequest("locationId 必须为正整数")
	}
	if round.DistanceKm != nil && (*round.DistanceKm < 0 || *round.DistanceKm > 40075) {
		return httputil.BadRequest("距离超出一周范围")
	}
	if round.Score < 0 || round.Score > 5000 {
		return httputil.BadRequest("单轮得分超限")
	}
	if round.ImageID != nil && !imageIDPattern.MatchString(*round.ImageID) {
		return httputil.BadRequest("imageId 包含非法字符")
	}
	if round.Xp != nil && (*round.Xp < 0 || *round.Xp > 5000) {
		return httputil.BadRequest("xp 超限")
	}
	if round.Difficulty != nil && (*round.Difficulty < 1 || *round.Difficulty > 5) {
		return httputil.BadRequest("难度需在 1-5 之间")
	}
	if round.GuessLat != nil && (*round.GuessLat < -90 || *round.GuessLat > 90) {
		return httputil.BadRequest("guessLat 超出范围")
	}
	if round.GuessLng != nil && (*round.GuessLng < -180 || *round.GuessLng > 180) {
		return httputil.BadRequest("guessLng 超出范围")
	}
	if round.AnswerLat != nil && (*round.AnswerLat < -90 || *round.AnswerLat > 90) {
		return httputil.BadRequest("answerLat 超出范围")
	}
	if round.AnswerLng != nil && (*round.AnswerLng < -180 || *round.AnswerLng > 180) {
		return httputil.BadRequest("answerLng 超出范围")
	}
	return nil
}

// handleGamesRecent returns the player's recent games.
func (s *Server) handleGamesRecent(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 30 {
			httputil.WriteError(w, http.StatusBadRequest, "limit 需为 1-30 的整数")
			return
		}
		limit = parsed
	}
	identity, _ := middleware.IdentityFrom(r.Context())
	games, err := s.services.Games.GetRecentGames(games.PlayerRef{Role: identity.Role, ID: identity.Subject}, limit)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"games": games})
}

// handleGamesBest returns the player's best game for a mode.
func (s *Server) handleGamesBest(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	if !contains(games.GameModes, mode) {
		httputil.WriteError(w, http.StatusBadRequest, "无效的游戏模式")
		return
	}
	identity, _ := middleware.IdentityFrom(r.Context())
	best, err := s.services.Games.GetBestGame(games.PlayerRef{Role: identity.Role, ID: identity.Subject}, mode)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"best": best})
}

// handleGamesSummary returns the player's progress snapshot.
func (s *Server) handleGamesSummary(w http.ResponseWriter, r *http.Request) {
	identity, _ := middleware.IdentityFrom(r.Context())
	progress, err := s.services.Auth.MeProgress(identity.Role, identity.Subject)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"progress": progress})
}

// handleGamesDelete removes a game owned by the player.
func (s *Server) handleGamesDelete(w http.ResponseWriter, r *http.Request) {
	raw := r.PathValue("gameId")
	gameID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || gameID < 1 {
		httputil.WriteError(w, http.StatusBadRequest, "gameId 需为正整数")
		return
	}
	identity, _ := middleware.IdentityFrom(r.Context())
	if err := s.services.Games.DeleteGame(games.PlayerRef{Role: identity.Role, ID: identity.Subject}, gameID); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
