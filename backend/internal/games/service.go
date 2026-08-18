package games

import (
	"math"

	"mma-guessr/backend/internal/achievements"
	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/daily"
	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/leaderboard"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/packs"
	"mma-guessr/backend/internal/profile"
	"mma-guessr/backend/internal/ratings"
)

const (
	distanceAbsoluteToleranceKm = 0.05
	distanceRelativeTolerance   = 0.02
)

// Service orchestrates game submission with server-authoritative scoring.
type Service struct {
	store        *Store
	progress     *auth.Store
	daily        *daily.Service
	leaderboard  *leaderboard.Service
	achievements *achievements.Service
	profile      *profile.Service
	ratings      *ratings.Service
	packs        *packs.Service
}

// NewService wires the games service with its dependencies.
func NewService(store *Store, progress *auth.Store, daily *daily.Service,
	leaderboard *leaderboard.Service, achievements *achievements.Service, profile *profile.Service,
	ratings *ratings.Service, packs *packs.Service) *Service {
	return &Service{store: store, progress: progress, daily: daily,
		leaderboard: leaderboard, achievements: achievements, profile: profile, ratings: ratings, packs: packs}
}

type verifiedRound struct {
	round GameRound
	score int
}

// SubmitGame validates, persists and settles a game submission.
func (s *Service) SubmitGame(player PlayerRef, input SubmitGameInput) (*GameRecord, error) {
	var verified []verifiedRound
	var err error

	if input.Mode == "daily" {
		verified, err = s.verifyDailyRoundsAuthoritative(input)
		if err != nil {
			return nil, err
		}
		hasAnyAnswer := false
		for _, entry := range verified {
			if entry.round.GuessLat != nil {
				hasAnyAnswer = true
				break
			}
		}
		if !hasAnyAnswer {
			return nil, httputil.BadRequest("每日挑战至少需作答一题")
		}
		if err := s.daily.GuardDailySubmission(player.Role, player.ID); err != nil {
			return nil, err
		}
	} else if input.Mode == "pack" {
		verified, err = s.verifyPackRoundsAuthoritative(player, input)
		if err != nil {
			return nil, err
		}
	} else {
		verified = make([]verifiedRound, 0, len(input.Rounds))
		for _, round := range input.Rounds {
			score, err := s.verifyRoundScore(input, round)
			if err != nil {
				return nil, err
			}
			verified = append(verified, verifiedRound{round: round, score: score})
		}
		verifiedTotal := 0
		for _, entry := range verified {
			verifiedTotal += entry.score
		}
		if input.TotalScore != verifiedTotal {
			return nil, httputil.BadRequest("总分与回合得分不一致")
		}
	}

	verifiedTotal := 0
	verifiedRounds := make([]GameRound, 0, len(verified))
	for _, entry := range verified {
		verifiedTotal += entry.score
		round := entry.round
		round.Score = entry.score
		verifiedRounds = append(verifiedRounds, round)
	}
	verifiedInput := SubmitGameInput{
		Mode:       input.Mode,
		Region:     input.Region,
		TotalScore: verifiedTotal,
		Rounds:     verifiedRounds,
		PackID:     input.PackID,
	}

	game, err := s.store.InsertGameRecord(player, verifiedInput)
	if err != nil {
		return nil, err
	}

	if input.Mode == "daily" {
		_ = s.daily.MarkClaimed(player.ID, daily.UTCDateString(), game.ID)
	}
	// Pack games are casual play: they persist for history/replay but are
	// excluded from progress, leaderboard, ratings and achievements so custom
	// (self-curated) packs cannot farm competitive stats.
	if input.Mode != "pack" {
		if err := s.accumulateProgress(player, verifiedInput); err != nil {
			return nil, err
		}
	}
	s.profile.InvalidateStatsCache(player.Role, player.ID)
	if player.Role == "user" && input.Mode != "pack" {
		_ = s.leaderboard.RecordScore(player.ID, input.Mode, verifiedTotal)
		s.achievements.EvaluateAndUnlock(player.ID)
		_ = s.ratings.ApplyGame(player.ID, verifiedTotal)
	}
	return game, nil
}

// verifyRoundScore recomputes the score from the claimed distance (and the
// geometry when present) and rejects any mismatch.
func (s *Service) verifyRoundScore(input SubmitGameInput, round GameRound) (int, error) {
	if round.DistanceKm == nil {
		if round.Score != 0 {
			return 0, httputil.BadRequest("超时轮得分必须为 0")
		}
		return 0, nil
	}
	if geometry := roundGeometryOf(round); geometry != nil {
		computed := HaversineKm(geometry.guessLat, geometry.guessLng, geometry.answerLat, geometry.answerLng)
		if !distanceWithinTolerance(computed, *round.DistanceKm) {
			return 0, httputil.BadRequest("距离与提交坐标不一致")
		}
	}
	expected := ComputeRoundScore(input.Mode, regionValue(input.Region), *round.DistanceKm)
	if round.Score != expected {
		return 0, httputil.BadRequest("单轮得分与距离不一致")
	}
	return expected, nil
}

// verifyDailyRoundsAuthoritative settles a daily challenge entirely on the
// server: the answer coordinates never reach the client during play.
func (s *Service) verifyDailyRoundsAuthoritative(input SubmitGameInput) ([]verifiedRound, error) {
	todayLocations, err := s.daily.GetTodayLocationRecords()
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]locations.LocationRecord, len(todayLocations))
	for _, location := range todayLocations {
		byID[location.ID] = location
	}

	out := make([]verifiedRound, 0, len(input.Rounds))
	for _, round := range input.Rounds {
		if round.LocationID == nil {
			return nil, httputil.BadRequest("回合题目不属于今日挑战题单")
		}
		location, ok := byID[*round.LocationID]
		if !ok {
			return nil, httputil.BadRequest("回合题目不属于今日挑战题单")
		}
		if round.DistanceKm != nil || round.AnswerLat != nil || round.AnswerLng != nil {
			return nil, httputil.BadRequest("每日挑战由服务端权威结算，客户端不得携带距离或答案坐标")
		}

		if !hasGuess(round) {
			round.DistanceKm = nil
			round.Score = 0
			round.AnswerLat = &location.Lat
			round.AnswerLng = &location.Lng
			out = append(out, verifiedRound{round: round, score: 0})
			continue
		}
		distanceKm := HaversineKm(*round.GuessLat, *round.GuessLng, location.Lat, location.Lng)
		score := ComputeRoundScore(input.Mode, regionValue(input.Region), distanceKm)
		round.DistanceKm = &distanceKm
		round.Score = score
		round.AnswerLat = &location.Lat
		round.AnswerLng = &location.Lng
		out = append(out, verifiedRound{round: round, score: score})
	}
	return out, nil
}

// verifyPackRoundsAuthoritative settles a pack game entirely on the server:
// the answer coordinates never reach the client during play. The pack must be
// public or owned by the submitting player.
func (s *Service) verifyPackRoundsAuthoritative(player PlayerRef, input SubmitGameInput) ([]verifiedRound, error) {
	if input.PackID == nil {
		return nil, httputil.BadRequest("图包模式必须指定 packId")
	}
	packLocations, err := s.packs.FetchPackLocations(*input.PackID, packs.PlayerRef{Role: player.Role, ID: player.ID})
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]packs.Location, len(packLocations))
	for _, location := range packLocations {
		byID[location.ID] = location
	}

	out := make([]verifiedRound, 0, len(input.Rounds))
	for _, round := range input.Rounds {
		if round.LocationID == nil {
			return nil, httputil.BadRequest("回合题目不属于该图包")
		}
		location, ok := byID[*round.LocationID]
		if !ok {
			return nil, httputil.BadRequest("回合题目不属于该图包")
		}
		if round.DistanceKm != nil || round.AnswerLat != nil || round.AnswerLng != nil {
			return nil, httputil.BadRequest("图包由服务端权威结算，客户端不得携带距离或答案坐标")
		}

		if !hasGuess(round) {
			round.DistanceKm = nil
			round.Score = 0
			round.AnswerLat = &location.Lat
			round.AnswerLng = &location.Lng
			out = append(out, verifiedRound{round: round, score: 0})
			continue
		}
		distanceKm := HaversineKm(*round.GuessLat, *round.GuessLng, location.Lat, location.Lng)
		score := ComputeRoundScore("pack", "", distanceKm)
		round.DistanceKm = &distanceKm
		round.Score = score
		round.AnswerLat = &location.Lat
		round.AnswerLng = &location.Lng
		out = append(out, verifiedRound{round: round, score: score})
	}
	return out, nil
}

func (s *Service) accumulateProgress(player PlayerRef, input SubmitGameInput) error {
	current, err := s.progress.GetProgress(player.Role, player.ID)
	if err != nil {
		return err
	}
	correct := 0
	for _, round := range input.Rounds {
		if round.Score > 0 {
			correct++
		}
	}
	snapshot := auth.Progress{
		TotalRounds:    current.TotalRounds + len(input.Rounds),
		TotalScore:     current.TotalScore + input.TotalScore,
		BestScore:      maxInt(current.BestScore, input.TotalScore),
		CorrectGuesses: current.CorrectGuesses + correct,
	}
	return s.progress.UpsertProgress(player.Role, player.ID, snapshot)
}

// GetRecentGames returns the player's latest games.
func (s *Service) GetRecentGames(player PlayerRef, limit int) ([]GameRecord, error) {
	return s.store.FetchRecentGames(player, limit)
}

// GetGame returns a single game owned by the player, or nil.
func (s *Service) GetGame(player PlayerRef, gameID int64) (*GameRecord, error) {
	return s.store.FetchGame(player, gameID)
}

// GetBestGame returns the player's best game for a mode (or nil).
func (s *Service) GetBestGame(player PlayerRef, mode string) (*GameRecord, error) {
	return s.store.FetchBestGame(player, mode)
}

// DeleteGame removes a game owned by the player.
func (s *Service) DeleteGame(player PlayerRef, gameID int64) error {
	deleted, err := s.store.DeleteGameRecord(player, gameID)
	if err != nil {
		return err
	}
	if !deleted {
		return httputil.NotFound("游戏记录不存在")
	}
	return nil
}

type geometry struct {
	guessLat  float64
	guessLng  float64
	answerLat float64
	answerLng float64
}

func roundGeometryOf(round GameRound) *geometry {
	if round.GuessLat != nil && round.GuessLng != nil && round.AnswerLat != nil && round.AnswerLng != nil {
		return &geometry{
			guessLat: *round.GuessLat, guessLng: *round.GuessLng,
			answerLat: *round.AnswerLat, answerLng: *round.AnswerLng,
		}
	}
	return nil
}

func distanceWithinTolerance(computedKm, claimedKm float64) bool {
	tolerance := math.Max(distanceAbsoluteToleranceKm, claimedKm*distanceRelativeTolerance)
	return math.Abs(computedKm-claimedKm) <= tolerance
}

func hasGuess(round GameRound) bool {
	return round.GuessLat != nil && round.GuessLng != nil
}

func regionValue(region *string) string {
	if region == nil {
		return ""
	}
	return *region
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
