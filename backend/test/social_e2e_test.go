package e2e

import (
	"net/http"
	"testing"
	"time"

	"mma-guessr/backend/internal/games"
)

// submitClassicGame submits a single-round classic game for the token at the
// given guess point and returns the total score.
func submitClassicGame(t *testing.T, e *testEnv, token string, guessLat, guessLng float64) int {
	t.Helper()
	const answerLat, answerLng = 31.0, 101.0
	distance := games.HaversineKm(guessLat, guessLng, answerLat, answerLng)
	score := games.ComputeRoundScore("classic", "", distance)
	round := map[string]any{
		"name":       "测试地点",
		"locationId": nil,
		"distanceKm": distance,
		"score":      score,
		"imageId":    nil,
		"xp":         0,
		"difficulty": 1,
		"guessLat":   guessLat,
		"guessLng":   guessLng,
		"answerLat":  answerLat,
		"answerLng":  answerLng,
	}
	resp := e.request(t, http.MethodPost, "/api/games", token, map[string]any{
		"mode":       "classic",
		"totalScore": score,
		"rounds":     []any{round},
	})
	if resp.status != http.StatusCreated {
		t.Fatalf("submit failed: %d %v", resp.status, resp.body)
	}
	return score
}

func TestLeaderboard(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(10)

	// Two users with different best scores.
	userA := registerUser(t, e, "alice", randomEmail("lb"), validPassword).nestedStr("tokenPair", "accessToken")
	userB := registerUser(t, e, "bob", randomEmail("lb"), validPassword).nestedStr("tokenPair", "accessToken")

	scoreA := submitClassicGame(t, e, userA, 30.0, 100.0)
	submitClassicGame(t, e, userB, 30.5, 100.5)
	scoreB := submitClassicGame(t, e, userB, 30.6, 100.6)

	t.Run("overall ranks by best score", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/leaderboard?mode=classic&period=overall&limit=10", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if resp.str("period") != "overall" || resp.str("mode") != "classic" {
			t.Fatalf("unexpected echo: %v", resp.body)
		}
		entries := resp.nestedArray("entries")
		if len(entries) != 2 {
			t.Fatalf("expected 2 entries, got %d", len(entries))
		}
		first := entries[0].(map[string]any)
		second := entries[1].(map[string]any)
		if first["score"].(float64) != float64(scoreB) {
			t.Fatalf("expected best score %d first, got %v", scoreB, first)
		}
		if second["username"] != "alice" {
			t.Fatalf("expected alice second, got %v", second)
		}
		if scoreA >= scoreB {
			t.Fatalf("test setup invalid: %d >= %d", scoreA, scoreB)
		}
	})

	t.Run("invalid mode rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/leaderboard?mode=zzz", "", nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})
}

func TestProfile(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(10)

	access := registerUser(t, e, uniqueUsername("tester"), randomEmail("profile"), validPassword).
		nestedStr("tokenPair", "accessToken")
	score := submitClassicGame(t, e, access, 30.0, 100.0)

	t.Run("profile aggregates stats", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/profile", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		stats := resp.nestedMap("stats")
		if stats["totalGames"] != float64(1) || stats["totalRounds"] != float64(1) {
			t.Fatalf("unexpected totals: %v", stats)
		}
		if stats["bestScore"] != float64(score) || stats["totalScore"] != float64(score) {
			t.Fatalf("unexpected scores: %v", stats)
		}
		if stats["bestMode"] != "classic" {
			t.Fatalf("unexpected bestMode: %v", stats["bestMode"])
		}
		if stats["correctGuesses"] != float64(1) || stats["accuracy"] != float64(100) {
			t.Fatalf("unexpected accuracy: %v", stats)
		}
		byMode := stats["byMode"].(map[string]any)
		classic := byMode["classic"].(map[string]any)
		if classic["games"] != float64(1) || classic["bestScore"] != float64(score) {
			t.Fatalf("unexpected byMode: %v", byMode)
		}
	})

	t.Run("profile requires auth", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/profile", "", nil)
		if resp.status != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.status)
		}
	})
}

func TestAchievements(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(10)

	access := registerUser(t, e, uniqueUsername("tester"), randomEmail("ach"), validPassword).
		nestedStr("tokenPair", "accessToken")

	t.Run("list returns 14 achievements with unlock states", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/achievements", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		achievements := resp.nestedArray("achievements")
		if len(achievements) != 14 {
			t.Fatalf("expected 14 achievements, got %d", len(achievements))
		}
		if resp.str("equippedTitle") != "" {
			t.Fatalf("expected no equipped title, got %v", resp.body["equippedTitle"])
		}
	})

	t.Run("first game unlocks first_game", func(t *testing.T) {
		submitClassicGame(t, e, access, 30.0, 100.0)
		resp := e.request(t, http.MethodGet, "/api/achievements", access, nil)
		achievements := resp.nestedArray("achievements")
		for _, raw := range achievements {
			item := raw.(map[string]any)
			if item["code"] == "first_game" && item["unlockedAt"] == nil {
				t.Fatal("first_game should be unlocked")
			}
		}
	})

	t.Run("equip title requires unlock", func(t *testing.T) {
		resp := e.request(t, http.MethodPut, "/api/achievements/title", access, map[string]any{"title": "高分达人"})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %v", resp.status, resp.body)
		}
	})

	t.Run("equip title after unlock works", func(t *testing.T) {
		// 20k single game is hard to reach legitimately; instead grant the
		// title for games_100-equivalent by direct insert.
		if _, err := e.conn.Exec(
			`INSERT INTO user_achievements (user_id, achievement_code, unlocked_at) VALUES (?, 'best_20k', ?)
			 ON CONFLICT DO NOTHING`, userIDOf(t, e, access), time.Now().UTC().Format("2006-01-02T15:04:05Z")); err != nil {
			t.Fatalf("seed achievement: %v", err)
		}
		resp := e.request(t, http.MethodPut, "/api/achievements/title", access, map[string]any{"title": "高分达人"})
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d: %v", resp.status, resp.body)
		}
		if resp.nestedStr("equippedTitle") != "高分达人" {
			t.Fatalf("unexpected equippedTitle %v", resp.body["equippedTitle"])
		}
	})

	t.Run("unknown title rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPut, "/api/achievements/title", access, map[string]any{"title": "不存在"})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("clear title via delete", func(t *testing.T) {
		resp := e.request(t, http.MethodDelete, "/api/achievements/title", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if resp.body["equippedTitle"] != nil {
			t.Fatalf("expected null, got %v", resp.body["equippedTitle"])
		}
	})

	t.Run("guest achievements rejected", func(t *testing.T) {
		guest := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
		resp := e.request(t, http.MethodGet, "/api/achievements", guest.str("guestToken"), nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})
}

// userIDOf resolves the user id from the me endpoint.
func userIDOf(t *testing.T, e *testEnv, token string) string {
	t.Helper()
	me := e.request(t, http.MethodGet, "/api/auth/me", token, nil)
	if me.status != http.StatusOK {
		t.Fatalf("me failed: %d", me.status)
	}
	return me.nestedStr("user", "id")
}
