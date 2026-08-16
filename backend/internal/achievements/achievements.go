package achievements

import (
	"database/sql"
	"errors"
	"log/slog"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

// Meta is the static definition of one achievement.
type Meta struct {
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Icon        string  `json:"icon"`
	HasTitle    bool    `json:"hasTitle"`
	Title       *string `json:"title"`
}

// View is the achievement as returned to the client.
type View struct {
	Meta
	UnlockedAt *string `json:"unlockedAt"`
}

// Payload is the achievements list response.
type Payload struct {
	Achievements  []View  `json:"achievements"`
	EquippedTitle *string `json:"equippedTitle"`
}

// Definitions mirrors the seeded achievements table.
var Definitions = []Meta{
	{Code: "first_game", Name: "首次游玩", Description: "完成第一局游戏", Icon: "🎮"},
	{Code: "games_10", Name: "渐入佳境", Description: "累计完成 10 局游戏", Icon: "🕹️"},
	{Code: "games_100", Name: "百局老兵", Description: "累计完成 100 局游戏", Icon: "🎖️", HasTitle: true, Title: strPtr("百局老兵")},
	{Code: "rounds_100", Name: "百轮历练", Description: "累计完成 100 轮挑战", Icon: "🔟"},
	{Code: "score_100k", Name: "十万大神", Description: "累计总分达到 100,000 分", Icon: "💎", HasTitle: true, Title: strPtr("十万大神")},
	{Code: "perfect_round", Name: "一击必中", Description: "单轮获得满分 5000 分", Icon: "🎯"},
	{Code: "perfect_game", Name: "登峰造极", Description: "完成一局且每轮均获满分", Icon: "🏆"},
	{Code: "mode_master", Name: "全能选手", Description: "体验全部 7 种单人游戏模式", Icon: "🌍", HasTitle: true, Title: strPtr("全能选手")},
	{Code: "daily_regular", Name: "每日坚持", Description: "累计完成 7 天每日挑战", Icon: "📅"},
	{Code: "daily_30", Name: "每日之星", Description: "累计完成 30 天每日挑战", Icon: "🌟", HasTitle: true, Title: strPtr("每日之星")},
	{Code: "accuracy_90", Name: "神射手", Description: "总命中率高于 90%", Icon: "🎖️", HasTitle: true, Title: strPtr("神射手")},
	{Code: "best_20k", Name: "高分达人", Description: "单局成绩达到 20,000 分", Icon: "🚀", HasTitle: true, Title: strPtr("高分达人")},
	{Code: "china_10", Name: "中国通", Description: "累计完成 10 局中国模式", Icon: "🐉", HasTitle: true, Title: strPtr("中国通")},
	{Code: "landmark_10", Name: "地标巡礼", Description: "累计完成 10 局地标模式", Icon: "🗼"},
}

// Aggregates is the server-authoritative unlock criteria snapshot.
type Aggregates struct {
	TotalGames     int
	TotalRounds    int
	TotalScore     int
	BestScore      int
	CorrectGuesses int
	PerfectRounds  int
	PerfectGames   int
	DistinctModes  int
	DailyCount     int
	ChinaCount     int
	LandmarkCount  int
}

// Service evaluates and manages achievements.
type Service struct {
	conn   *sql.DB
	logger *slog.Logger
}

// NewService creates an achievements Service.
func NewService(conn *sql.DB, logger *slog.Logger) *Service {
	return &Service{conn: conn, logger: logger}
}

// EvaluateUnlocked returns the codes whose conditions are met.
func EvaluateUnlocked(a Aggregates) []string {
	accuracy := 0.0
	if a.TotalRounds > 0 {
		accuracy = float64(a.CorrectGuesses) / float64(a.TotalRounds) * 100
	}
	var codes []string
	conditions := []struct {
		code string
		met  bool
	}{
		{"first_game", a.TotalGames >= 1},
		{"games_10", a.TotalGames >= 10},
		{"games_100", a.TotalGames >= 100},
		{"rounds_100", a.TotalRounds >= 100},
		{"score_100k", a.TotalScore >= 100_000},
		{"perfect_round", a.PerfectRounds >= 1},
		{"perfect_game", a.PerfectGames >= 1},
		{"mode_master", a.DistinctModes >= 7},
		{"daily_regular", a.DailyCount >= 7},
		{"daily_30", a.DailyCount >= 30},
		{"accuracy_90", accuracy >= 90},
		{"best_20k", a.BestScore >= 20_000},
		{"china_10", a.ChinaCount >= 10},
		{"landmark_10", a.LandmarkCount >= 10},
	}
	for _, condition := range conditions {
		if condition.met {
			codes = append(codes, condition.code)
		}
	}
	return codes
}

// EvaluateAndUnlock inserts newly met achievements. Failures never block the
// game submission flow.
func (s *Service) EvaluateAndUnlock(userID string) {
	aggregates, err := s.FetchAggregates(userID)
	if err != nil {
		s.logger.Warn("achievement aggregates failed", "user", userID, "error", err)
		return
	}
	unlocked, err := s.FetchUnlockedCodes(userID)
	if err != nil {
		s.logger.Warn("achievement unlocked fetch failed", "user", userID, "error", err)
		return
	}
	var newly []string
	for _, code := range EvaluateUnlocked(aggregates) {
		if _, ok := unlocked[code]; !ok {
			newly = append(newly, code)
		}
	}
	if len(newly) == 0 {
		return
	}
	if err := s.InsertUnlockedCodes(userID, newly); err != nil {
		s.logger.Warn("achievement unlock insert failed", "user", userID, "error", err)
	}
}

// FetchAggregates computes the unlock criteria from game_results.
func (s *Service) FetchAggregates(userID string) (Aggregates, error) {
	var a Aggregates
	err := s.conn.QueryRow(
		`SELECT COUNT(*),
		        COALESCE(SUM(json_array_length(rounds)), 0),
		        COALESCE(SUM(total_score), 0),
		        COALESCE(MAX(total_score), 0),
		        COUNT(DISTINCT mode),
		        SUM(CASE WHEN mode = 'daily' THEN 1 ELSE 0 END),
		        SUM(CASE WHEN mode = 'china' THEN 1 ELSE 0 END),
		        SUM(CASE WHEN mode = 'landmark' THEN 1 ELSE 0 END)
		 FROM game_results WHERE player_type = 'user' AND player_id = ?`,
		userID).Scan(&a.TotalGames, &a.TotalRounds, &a.TotalScore, &a.BestScore,
		&a.DistinctModes, &a.DailyCount, &a.ChinaCount, &a.LandmarkCount)
	if err != nil {
		return a, err
	}
	err = s.conn.QueryRow(
		`SELECT SUM(CASE WHEN CAST(json_extract(value, '$.score') AS INTEGER) > 0 THEN 1 ELSE 0 END),
		        SUM(CASE WHEN CAST(json_extract(value, '$.score') AS INTEGER) >= 5000 THEN 1 ELSE 0 END)
		 FROM game_results CROSS JOIN json_each(rounds)
		 WHERE player_type = 'user' AND player_id = ?`,
		userID).Scan(&a.CorrectGuesses, &a.PerfectRounds)
	if err != nil {
		return a, err
	}
	err = s.conn.QueryRow(
		`SELECT COUNT(*) FROM game_results
		 WHERE player_type = 'user' AND player_id = ? AND json_array_length(rounds) > 0
		   AND (SELECT COUNT(*) FROM json_each(rounds)
		        WHERE CAST(json_extract(value, '$.score') AS INTEGER) < 5000) = 0`,
		userID).Scan(&a.PerfectGames)
	return a, err
}

// FetchUnlockedCodes returns code → unlockedAt.
func (s *Service) FetchUnlockedCodes(userID string) (map[string]string, error) {
	rows, err := s.conn.Query(
		`SELECT achievement_code, unlocked_at FROM user_achievements WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var code, unlockedAt string
		if err := rows.Scan(&code, &unlockedAt); err != nil {
			return nil, err
		}
		out[code] = unlockedAt
	}
	return out, rows.Err()
}

// InsertUnlockedCodes inserts newly unlocked achievements (idempotent).
func (s *Service) InsertUnlockedCodes(userID string, codes []string) error {
	for _, code := range codes {
		_, err := s.conn.Exec(
			`INSERT INTO user_achievements (user_id, achievement_code, unlocked_at)
			 VALUES (?, ?, ?) ON CONFLICT(user_id, achievement_code) DO NOTHING`,
			userID, code, util.Now())
		if err != nil {
			return err
		}
	}
	return nil
}

// FetchEquippedTitle returns the user's equipped title.
func (s *Service) FetchEquippedTitle(userID string) (*string, error) {
	var title sql.NullString
	err := s.conn.QueryRow(
		`SELECT equipped_title FROM users WHERE id = ?`, userID).Scan(&title)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !title.Valid {
		return nil, nil
	}
	return &title.String, nil
}

// UpdateEquippedTitle sets or clears the equipped title.
func (s *Service) UpdateEquippedTitle(userID string, title *string) error {
	_, err := s.conn.Exec(
		`UPDATE users SET equipped_title = ?, updated_at = ? WHERE id = ?`,
		title, util.Now(), userID)
	return err
}

// GetAchievements returns the full list with unlock states (users only).
func (s *Service) GetAchievements(userID string) (*Payload, error) {
	unlocked, err := s.FetchUnlockedCodes(userID)
	if err != nil {
		return nil, err
	}
	equipped, err := s.FetchEquippedTitle(userID)
	if err != nil {
		return nil, err
	}
	views := make([]View, 0, len(Definitions))
	for _, meta := range Definitions {
		views = append(views, View{Meta: meta, UnlockedAt: unlockedAtPtr(unlocked[meta.Code])})
	}
	return &Payload{Achievements: views, EquippedTitle: equipped}, nil
}

// EquipTitle validates and applies the equipped title (null clears it).
func (s *Service) EquipTitle(userID string, title *string) (*string, error) {
	if title == nil || *title == "" {
		if err := s.UpdateEquippedTitle(userID, nil); err != nil {
			return nil, err
		}
		return nil, nil
	}
	unlocked, err := s.FetchUnlockedCodes(userID)
	if err != nil {
		return nil, err
	}
	var matching *Meta
	for i := range Definitions {
		if Definitions[i].HasTitle && Definitions[i].Title != nil && *Definitions[i].Title == *title {
			matching = &Definitions[i]
			break
		}
	}
	if matching == nil {
		return nil, httputil.BadRequest("该称号不存在")
	}
	if _, ok := unlocked[matching.Code]; !ok {
		return nil, httputil.BadRequest("尚未解锁该称号对应的成就")
	}
	if err := s.UpdateEquippedTitle(userID, title); err != nil {
		return nil, err
	}
	return title, nil
}

func unlockedAtPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func strPtr(value string) *string {
	return &value
}
