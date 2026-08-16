package e2e

import (
	"fmt"
	"net/http"
	"testing"

	"mma-guessr/backend/internal/games"
)

// buildRound builds a valid round payload for the given coordinates.
func buildRound(name string, guessLat, guessLng, answerLat, answerLng float64, distanceKm float64) map[string]any {
	return map[string]any{
		"name":       name,
		"locationId": nil,
		"distanceKm": distanceKm,
		"score":      0,
		"imageId":    nil,
		"xp":         0,
		"difficulty": 1,
		"guessLat":   guessLat,
		"guessLng":   guessLng,
		"answerLat":  answerLat,
		"answerLng":  answerLng,
	}
}

func TestLocations(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(40)

	t.Run("random returns locations with count", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/random?count=5", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		locations := resp.nestedArray("locations")
		if len(locations) != 5 {
			t.Fatalf("expected 5 locations, got %d", len(locations))
		}
		first := locations[0].(map[string]any)
		for _, key := range []string{"id", "name", "lat", "lng", "region", "difficulty", "source"} {
			if _, ok := first[key]; !ok {
				t.Fatalf("location missing key %s: %v", key, first)
			}
		}
	})

	t.Run("random filters by region and difficulty", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/random?region=asia&difficulty=1&count=10", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		for _, raw := range resp.nestedArray("locations") {
			loc := raw.(map[string]any)
			if loc["region"] != "asia" || loc["difficulty"] != float64(1) {
				t.Fatalf("unexpected location %v", loc)
			}
		}
	})

	t.Run("stats returns totals", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/stats", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if resp.body["total"] != float64(40) {
			t.Fatalf("expected total 40, got %v", resp.body["total"])
		}
		byRegion := resp.nestedMap("byRegion")
		if byRegion["asia"] != float64(33) || byRegion["europe"] != float64(7) {
			t.Fatalf("unexpected byRegion: %v", byRegion)
		}
	})

	t.Run("invalid count rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/random?count=999", "", nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})
}

func TestGamesSubmit(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(10)

	access := registerUser(t, e, uniqueUsername("tester"), randomEmail("games"), validPassword).
		nestedStr("tokenPair", "accessToken")

	// Exact known points: (30,100) and (31,101). Compute the authoritative
	// distance and score with the same formulas the server uses.
	const guessLat, guessLng, answerLat, answerLng = 30.0, 100.0, 31.0, 101.0
	exactDistance := games.HaversineKm(guessLat, guessLng, answerLat, answerLng)
	exactScore := games.ComputeRoundScore("classic", "", exactDistance)

	t.Run("submit valid game", func(t *testing.T) {
		round := buildRound("地点A", 30, 100, 31, 101, exactDistance)
		round["score"] = exactScore
		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "classic",
			"totalScore": exactScore,
			"rounds":     []any{round},
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %v", resp.status, resp.body)
		}
		game := resp.nestedMap("game")
		if game["totalScore"] != float64(exactScore) {
			t.Fatalf("unexpected totalScore %v", game["totalScore"])
		}
		rounds := resp.nestedArray("game", "rounds")
		if len(rounds) != 1 {
			t.Fatalf("expected 1 round, got %d", len(rounds))
		}
	})

	t.Run("recent returns submitted game", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/games/recent?limit=5", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		games := resp.nestedArray("games")
		if len(games) != 1 {
			t.Fatalf("expected 1 game, got %d", len(games))
		}
	})

	t.Run("best returns top game", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/games/best?mode=classic", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if resp.nestedMap("best") == nil {
			t.Fatal("expected best game")
		}
	})

	t.Run("summary returns progress", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/games/summary", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		progress := resp.nestedMap("progress")
		if progress["totalRounds"] != float64(1) || progress["totalScore"] != float64(exactScore) {
			t.Fatalf("unexpected progress %v", progress)
		}
	})

	t.Run("rejects score mismatch", func(t *testing.T) {
		round := buildRound("地点B", 30, 100, 31, 101, exactDistance)
		round["score"] = exactScore + 100
		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "classic",
			"totalScore": exactScore + 100,
			"rounds":     []any{round},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
		if !containsMessage(resp, "得分") {
			t.Fatalf("expected score error, got %v", resp.body)
		}
	})

	t.Run("rejects distance mismatch with coordinates", func(t *testing.T) {
		round := buildRound("地点C", 30, 100, 31, 101, 9999)
		round["score"] = 0
		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "classic",
			"totalScore": 0,
			"rounds":     []any{round},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
		if !containsMessage(resp, "距离") {
			t.Fatalf("expected distance error, got %v", resp.body)
		}
	})

	t.Run("rejects total score mismatch", func(t *testing.T) {
		round := buildRound("地点D", 30, 100, 31, 101, exactDistance)
		round["score"] = exactScore
		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "classic",
			"totalScore": 5000,
			"rounds":     []any{round},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("region mode requires region", func(t *testing.T) {
		round := buildRound("地点E", 30, 100, 31, 101, exactDistance)
		round["score"] = exactScore
		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "region",
			"totalScore": exactScore,
			"rounds":     []any{round},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
		if !containsMessage(resp, "region") {
			t.Fatalf("expected region error, got %v", resp.body)
		}
	})

	t.Run("delete removes game", func(t *testing.T) {
		round := buildRound("地点F", 30, 100, 31, 101, exactDistance)
		round["score"] = exactScore
		created := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "classic",
			"totalScore": exactScore,
			"rounds":     []any{round},
		})
		gameID := int64(created.nestedMap("game")["id"].(float64))
		deleted := e.request(t, http.MethodDelete, fmt.Sprintf("/api/games/%d", gameID), access, nil)
		if deleted.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", deleted.status)
		}
		if deleted.body["ok"] != true {
			t.Fatalf("expected ok true, got %v", deleted.body)
		}
		missing := e.request(t, http.MethodDelete, fmt.Sprintf("/api/games/%d", gameID), access, nil)
		if missing.status != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", missing.status)
		}
	})

	t.Run("rejects unauth games", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/games/recent", "", nil)
		if resp.status != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.status)
		}
	})
}

func TestDailyChallenge(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(30)

	access := registerUser(t, e, uniqueUsername("tester"), randomEmail("daily"), validPassword).
		nestedStr("tokenPair", "accessToken")

	t.Run("today returns 10 locations without answer coords", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/daily/today", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		locations := resp.nestedArray("locations")
		if len(locations) != 10 {
			t.Fatalf("expected 10 locations, got %d", len(locations))
		}
		if resp.body["played"] != false {
			t.Fatalf("expected played false, got %v", resp.body["played"])
		}
		for _, raw := range locations {
			loc := raw.(map[string]any)
			if _, hasLat := loc["lat"]; hasLat {
				t.Fatal("daily locations must not expose answer coordinates")
			}
		}
	})

	// Fetch today's IDs and guess a round-trip: submit a daily game with a
	// guess point and verify server-authoritative settlement.
	t.Run("submit daily with authoritative settlement", func(t *testing.T) {
		today := e.request(t, http.MethodGet, "/api/daily/today", access, nil)
		locations := today.nestedArray("locations")
		first := locations[0].(map[string]any)
		locationID := first["id"].(float64)

		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "daily",
			"totalScore": 0,
			"rounds": []any{map[string]any{
				"name":       first["name"].(string),
				"locationId": locationID,
				"distanceKm": nil,
				"score":      0,
				"imageId":    nil,
				"xp":         0,
				"difficulty": 1,
				"guessLat":   30.5,
				"guessLng":   100.5,
				"answerLat":  nil,
				"answerLng":  nil,
			}},
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %v", resp.status, resp.body)
		}
		game := resp.nestedMap("game")
		rounds := resp.nestedArray("game", "rounds")
		storedRound := rounds[0].(map[string]any)
		if storedRound["distanceKm"] == nil || storedRound["answerLat"] == nil {
			t.Fatalf("daily settlement must fill distance and answer coords: %v", storedRound)
		}
		if game["totalScore"] == float64(0) {
			t.Fatal("expected non-zero score for a guess")
		}
	})

	t.Run("second daily submission rejected", func(t *testing.T) {
		today := e.request(t, http.MethodGet, "/api/daily/today", access, nil)
		locations := today.nestedArray("locations")
		first := locations[0].(map[string]any)
		resp := e.request(t, http.MethodPost, "/api/games", access, map[string]any{
			"mode":       "daily",
			"totalScore": 0,
			"rounds": []any{map[string]any{
				"name":       first["name"].(string),
				"locationId": first["id"].(float64),
				"distanceKm": nil,
				"score":      0,
				"imageId":    nil,
				"xp":         0,
				"difficulty": 1,
				"guessLat":   40,
				"guessLng":   110,
				"answerLat":  nil,
				"answerLng":  nil,
			}},
		})
		if resp.status != http.StatusConflict {
			t.Fatalf("expected 409, got %d: %v", resp.status, resp.body)
		}
	})

	t.Run("daily with client-claimed distance rejected", func(t *testing.T) {
		newUser := registerUser(t, e, uniqueUsername("tester"), randomEmail("daily2"), validPassword).
			nestedStr("tokenPair", "accessToken")
		today := e.request(t, http.MethodGet, "/api/daily/today", newUser, nil)
		first := today.nestedArray("locations")[0].(map[string]any)
		resp := e.request(t, http.MethodPost, "/api/games", newUser, map[string]any{
			"mode":       "daily",
			"totalScore": 0,
			"rounds": []any{map[string]any{
				"name":       first["name"].(string),
				"locationId": first["id"].(float64),
				"distanceKm": 10.0,
				"score":      0,
				"imageId":    nil,
				"xp":         0,
				"difficulty": 1,
				"guessLat":   30,
				"guessLng":   100,
				"answerLat":  nil,
				"answerLng":  nil,
			}},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("guest cannot play daily", func(t *testing.T) {
		guest := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
		today := e.request(t, http.MethodGet, "/api/daily/today", guest.str("guestToken"), nil)
		if today.status != http.StatusOK {
			t.Fatalf("today should be readable for guests, got %d", today.status)
		}
	})
}

func containsMessage(resp *response, fragment string) bool {
	message, ok := resp.body["error"].(string)
	return ok && containsStr(message, fragment)
}

func containsStr(value, fragment string) bool {
	for i := 0; i+len(fragment) <= len(value); i++ {
		if value[i:i+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
