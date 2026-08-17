package e2e

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"mma-guessr/backend/internal/ratings"
)

func TestFriends(t *testing.T) {
	e := newTestEnv(t)

	userA := registerUser(t, e, uniqueUsername("friendA"), randomEmail("frd"), validPassword)
	accessA := userA.nestedStr("tokenPair", "accessToken")
	idA := userA.nestedStr("user", "id")
	usernameB := uniqueUsername("friendB")
	userB := registerUser(t, e, usernameB, randomEmail("frd"), validPassword)
	accessB := userB.nestedStr("tokenPair", "accessToken")
	idB := userB.nestedStr("user", "id")

	t.Run("send request by username", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/friends/requests", accessA, map[string]any{"targetUsername": usernameB})
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d %v", resp.status, resp.body)
		}
	})

	t.Run("duplicate request rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/friends/requests", accessA, map[string]any{"targetUserId": idB})
		if resp.status != http.StatusConflict {
			t.Fatalf("expected 409, got %d", resp.status)
		}
	})

	t.Run("self request rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/friends/requests", accessA, map[string]any{"targetUserId": idA})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("accept and list friends", func(t *testing.T) {
		reqs := e.request(t, http.MethodGet, "/api/friends/requests", accessB, nil)
		incoming := reqs.nestedArray("incoming")
		if len(incoming) != 1 {
			t.Fatalf("expected 1 incoming request, got %d", len(incoming))
		}
		first := incoming[0].(map[string]any)
		if first["id"] != idA {
			t.Fatalf("unexpected requester %v", first)
		}

		resp := e.request(t, http.MethodPost, "/api/friends/requests/"+idA+"/accept", accessB, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("accept failed: %d %v", resp.status, resp.body)
		}

		friends := e.request(t, http.MethodGet, "/api/friends", accessA, nil)
		if list := friends.nestedArray("friends"); len(list) != 1 {
			t.Fatalf("expected 1 friend, got %v", list)
		}
		friendsB := e.request(t, http.MethodGet, "/api/friends", accessB, nil)
		if list := friendsB.nestedArray("friends"); len(list) != 1 {
			t.Fatalf("expected 1 friend for B, got %v", list)
		}
	})

	t.Run("remove friendship", func(t *testing.T) {
		resp := e.request(t, http.MethodDelete, "/api/friends/"+idB, accessA, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("remove failed: %d %v", resp.status, resp.body)
		}
		friends := e.request(t, http.MethodGet, "/api/friends", accessA, nil)
		if list := friends.nestedArray("friends"); len(list) != 0 {
			t.Fatalf("expected 0 friends, got %v", list)
		}
	})
}

func TestSponsors(t *testing.T) {
	e := newTestEnv(t)

	t.Run("public list starts empty", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/sponsors", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		if list := resp.nestedArray("sponsors"); len(list) != 0 {
			t.Fatalf("expected no sponsors, got %v", list)
		}
	})

	t.Run("write without admin token rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/sponsors", "", map[string]any{"name": "hacker"})
		if resp.status == http.StatusOK {
			t.Fatalf("expected rejection, got %d", resp.status)
		}
	})

	t.Run("admin adds and lists a sponsor", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/sponsors", "test-admin-token",
			map[string]any{"name": "赞助者甲", "note": "感谢支持", "amountCents": 10000, "visible": true})
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d %v", resp.status, resp.body)
		}

		list := e.request(t, http.MethodGet, "/api/sponsors", "", nil)
		sponsors := list.nestedArray("sponsors")
		if len(sponsors) != 1 {
			t.Fatalf("expected 1 sponsor, got %v", sponsors)
		}
		first := sponsors[0].(map[string]any)
		if first["name"] != "赞助者甲" || first["amountCents"] != float64(10000) {
			t.Fatalf("unexpected sponsor %v", first)
		}
		id := int64(first["id"].(float64))

		del := e.request(t, http.MethodDelete, "/api/sponsors/"+strconv.FormatInt(id, 10), "test-admin-token", nil)
		if del.status != http.StatusOK {
			t.Fatalf("delete failed: %d %v", del.status, del.body)
		}
	})
}

func TestRatings(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(10)

	userA := registerUser(t, e, uniqueUsername("rated"), randomEmail("rtg"), validPassword)
	access := userA.nestedStr("tokenPair", "accessToken")
	score := submitClassicGame(t, e, access, 30.0, 100.0)

	t.Run("rating snapshot after one game", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/ratings", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		rating := resp.nestedMap("rating")
		if rating["gamesPlayed"] != float64(1) {
			t.Fatalf("expected 1 game played, got %v", rating)
		}
		got := int(rating["rating"].(float64))
		expected := 1000 + ratings.RatingDelta(score)
		if got != expected {
			t.Fatalf("expected rating %d, got %d", expected, got)
		}
		if rating["season"] == "" || rating["tier"] == nil {
			t.Fatalf("missing season/tier: %v", rating)
		}
	})

	t.Run("ladder leaderboard lists the user", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/ratings", access, nil)
		board := resp.nestedArray("leaderboard")
		if len(board) != 1 {
			t.Fatalf("expected 1 entry, got %v", board)
		}
	})
}

func TestDailyLeaderboard(t *testing.T) {
	e := newTestEnv(t)

	user := registerUser(t, e, uniqueUsername("dailyPlayer"), randomEmail("dlb"), validPassword)
	userID := user.nestedStr("user", "id")
	access := user.nestedStr("tokenPair", "accessToken")
	date := time.Now().UTC().Format("2006-01-02")
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")

	gameRes, err := e.conn.Exec(
		`INSERT INTO game_results (player_type, player_id, mode, region, total_score, rounds, created_at)
		 VALUES ('user', ?, 'daily', NULL, 43210, '[{"name":"x"}]', ?)`, userID, now)
	if err != nil {
		t.Fatalf("insert game: %v", err)
	}
	gameID, _ := gameRes.LastInsertId()
	_, err = e.conn.Exec(
		`INSERT INTO daily_submissions (player_id, date, game_id, created_at) VALUES (?, ?, ?, ?)`,
		userID, date, gameID, now)
	if err != nil {
		t.Fatalf("insert submission: %v", err)
	}

	resp := e.request(t, http.MethodGet, "/api/daily/leaderboard", access, nil)
	if resp.status != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.status)
	}
	entries := resp.nestedArray("entries")
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %v", entries)
	}
	first := entries[0].(map[string]any)
	if first["score"] != float64(43210) {
		t.Fatalf("unexpected score %v", first)
	}
}

func TestGameReplayAndCollections(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(10)

	user := registerUser(t, e, uniqueUsername("replayer"), randomEmail("rpl"), validPassword)
	access := user.nestedStr("tokenPair", "accessToken")
	submitClassicGame(t, e, access, 30.0, 100.0)

	t.Run("fetch a game with round coordinates", func(t *testing.T) {
		recent := e.request(t, http.MethodGet, "/api/games/recent?limit=1", access, nil)
		games := recent.nestedArray("games")
		if len(games) != 1 {
			t.Fatalf("expected 1 recent game, got %v", games)
		}
		gameID := int64(games[0].(map[string]any)["id"].(float64))

		resp := e.request(t, http.MethodGet, "/api/games/"+strconv.FormatInt(gameID, 10), access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		game := resp.nestedMap("game")
		rounds := game["rounds"].([]any)
		first := rounds[0].(map[string]any)
		if _, ok := first["guessLat"]; !ok {
			t.Fatalf("replay must include guess coordinates: %v", first)
		}
		if first["name"] != "测试地点" {
			t.Fatalf("unexpected round name %v", first)
		}
	})

	t.Run("collections lists identified locations", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/profile/collections", access, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		items := resp.nestedArray("items")
		if len(items) != 1 {
			t.Fatalf("expected 1 collection item, got %v", items)
		}
		first := items[0].(map[string]any)
		if first["name"] != "测试地点" || first["count"] != float64(1) {
			t.Fatalf("unexpected collection %v", first)
		}
	})
}

func TestFacts(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocationsTyped([]struct {
		Name       string
		Lat, Lng   float64
		Region     string
		Difficulty int
	}{
		{Name: "长城", Lat: 40.4, Lng: 116.5, Region: "asia", Difficulty: 5},
		{Name: "无名小站", Lat: 30.0, Lng: 100.0, Region: "europe", Difficulty: 1},
	})

	t.Run("curated fact", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/fact?name=%E9%95%BF%E5%9F%8E", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		fact := resp.str("fact")
		if fact == "" || fact == "未知" {
			t.Fatalf("expected curated fact, got %q", fact)
		}
	})

	t.Run("templated fallback fact", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/fact?name=%E6%97%A0%E5%90%8D%E5%B0%8F%E7%AB%99", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		fact := resp.str("fact")
		if !stringsHasPrefix(fact, "「无名小站」位于欧洲区域") {
			t.Fatalf("unexpected fallback fact %q", fact)
		}
	})

	t.Run("unknown location", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/locations/fact?name=zzz", "", nil)
		if resp.status != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", resp.status)
		}
	})
}

func stringsHasPrefix(s, prefix string) bool {
	return strings.HasPrefix(s, prefix)
}