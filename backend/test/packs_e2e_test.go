package e2e

import (
	"net/http"
	"strconv"
	"testing"

	"mma-guessr/backend/internal/games"
)

func buildPackRound(name string, locationID, guessLat, guessLng float64) map[string]any {
	return map[string]any{
		"name":       name,
		"locationId": locationID,
		"distanceKm": nil,
		"score":      0,
		"imageId":    "img-abcdef1234567890",
		"xp":         0,
		"difficulty": 2,
		"guessLat":   guessLat,
		"guessLng":   guessLng,
		"answerLat":  nil,
		"answerLng":  nil,
	}
}

func TestPacksWorkshop(t *testing.T) {
	e := newTestEnv(t)

	owner := registerUser(t, e, uniqueUsername("packer"), randomEmail("pack"), validPassword).
		nestedStr("tokenPair", "accessToken")
	other := registerUser(t, e, uniqueUsername("viewer"), randomEmail("pack2"), validPassword).
		nestedStr("tokenPair", "accessToken")

	// createPack is a helper that creates a pack and returns its id.
	createPack := func(token, name string, isPublic bool) int64 {
		resp := e.request(t, http.MethodPost, "/api/packs", token, map[string]any{
			"name":        name,
			"description": "测试图包",
			"isPublic":    isPublic,
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("create pack failed: %d %v", resp.status, resp.body)
		}
		id := int64(resp.nestedMap("pack")["id"].(float64))
		t.Logf("created pack %d name=%q owner=%q", id, name, token)
		return id
	}

	t.Run("guest cannot create pack", func(t *testing.T) {
		guest := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
		resp := e.request(t, http.MethodPost, "/api/packs", guest.str("guestToken"), map[string]any{
			"name": "guest pack", "description": "", "isPublic": true,
		})
		if resp.status != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", resp.status)
		}
	})

	t.Run("create and list pack", func(t *testing.T) {
		id := createPack(owner, "我的图包", true)
		resp := e.request(t, http.MethodGet, "/api/packs?mine=1", owner, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		packs := resp.nestedArray("packs")
		if len(packs) != 1 {
			t.Fatalf("expected 1 pack, got %d", len(packs))
		}
		pack := packs[0].(map[string]any)
		if pack["id"] != float64(id) || pack["name"] != "我的图包" || pack["isPublic"] != true {
			t.Fatalf("unexpected pack %v", pack)
		}
	})

	t.Run("invalid pack metadata rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/packs", owner, map[string]any{
			"name": "", "description": "", "isPublic": true,
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("replace locations and play", func(t *testing.T) {
		id := createPack(owner, "可玩图包", true)
		// Location A at (30,100), Location B at (31,101).
		resp := e.request(t, http.MethodPost, "/api/packs/"+strconv.FormatInt(id, 10)+"/locations", owner, map[string]any{
			"locations": []any{
				map[string]any{"name": "图包地点A", "lat": 30.0, "lng": 100.0, "difficulty": 2, "region": "asia", "imageId": "img-aaaaaaaaaaaaaaaa"},
				map[string]any{"name": "图包地点B", "lat": 31.0, "lng": 101.0, "difficulty": 3, "region": "asia", "imageId": "img-bbbbbbbbbbbbbbbb"},
			},
		})
		if resp.status != http.StatusOK {
			t.Fatalf("replace locations failed: %d %v", resp.status, resp.body)
		}

		// Another user can read the pack metadata but not the geometry.
		get := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10), other, nil)
		if get.status != http.StatusOK {
			t.Fatalf("expected 200 for public pack read, got %d", get.status)
		}
		locList := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/locations", other, nil)
		if locList.status != http.StatusOK {
			t.Fatalf("expected 200 for public locations read, got %d", locList.status)
		}

		play := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/play", other, nil)
		if play.status != http.StatusOK {
			t.Fatalf("expected 200, got %d: %v", play.status, play.body)
		}
		locations := play.nestedArray("locations")
		if len(locations) != 2 {
			t.Fatalf("expected 2 locations, got %d", len(locations))
		}
		for _, raw := range locations {
			loc := raw.(map[string]any)
			if _, hasLat := loc["lat"]; hasLat {
				t.Fatal("play locations must not expose answer coordinates")
			}
			for _, key := range []string{"id", "name", "difficulty", "region", "mapillaryId", "panoramaUrl"} {
				if _, ok := loc[key]; !ok {
					t.Fatalf("play location missing key %s: %v", key, loc)
				}
			}
		}
	})

	t.Run("submit pack game with authoritative settlement", func(t *testing.T) {
		id := createPack(owner, "结算图包", true)
		e.request(t, http.MethodPost, "/api/packs/"+strconv.FormatInt(id, 10)+"/locations", owner, map[string]any{
			"locations": []any{
				map[string]any{"name": "地点A", "lat": 30.0, "lng": 100.0, "difficulty": 1, "region": "asia", "imageId": "img-cccccccccccccccc"},
				map[string]any{"name": "地点B", "lat": 31.0, "lng": 101.0, "difficulty": 1, "region": "asia", "imageId": "img-dddddddddddddddd"},
			},
		})
		play := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/play", other, nil)
		locations := play.nestedArray("locations")
		first := locations[0].(map[string]any)
		locationID := first["id"].(float64)

		const guessLat, guessLng, answerLat, answerLng = 29.0, 99.0, 30.0, 100.0
		expectedDistance := games.HaversineKm(guessLat, guessLng, answerLat, answerLng)
		expectedScore := games.ComputeRoundScore("pack", "", expectedDistance)

		resp := e.request(t, http.MethodPost, "/api/games", other, map[string]any{
			"mode":       "pack",
			"totalScore": 0,
			"packId":     id,
			"rounds": []any{map[string]any{
				"name":       first["name"].(string),
				"locationId": locationID,
				"distanceKm": nil,
				"score":      0,
				"imageId":    "img-abcdef1234567890",
				"xp":         0,
				"difficulty": 1,
				"guessLat":   guessLat,
				"guessLng":   guessLng,
				"answerLat":  nil,
				"answerLng":  nil,
			}},
		})
		if resp.status != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %v", resp.status, resp.body)
		}
		game := resp.nestedMap("game")
		if game["packId"] != float64(id) {
			t.Fatalf("expected packId %d, got %v", id, game["packId"])
		}
		rounds := resp.nestedArray("game", "rounds")
		stored := rounds[0].(map[string]any)
		if stored["distanceKm"] == nil || stored["answerLat"] == nil {
			t.Fatalf("pack settlement must fill distance and answer coords: %v", stored)
		}
		if game["totalScore"] != float64(expectedScore) {
			t.Fatalf("expected score %d, got %v", expectedScore, game["totalScore"])
		}
	})

	t.Run("pack game excluded from progress and leaderboard", func(t *testing.T) {
		id := createPack(owner, "隔离图包", true)
		e.request(t, http.MethodPost, "/api/packs/"+strconv.FormatInt(id, 10)+"/locations", owner, map[string]any{
			"locations": []any{
				map[string]any{"name": "地点A", "lat": 30.0, "lng": 100.0, "difficulty": 1, "region": "asia", "imageId": "img-eeeeeeeeeeeeeeee"},
			},
		})

		// A classic game that must be counted.
		const guessLat, guessLng, answerLat, answerLng = 30.0, 100.0, 31.0, 101.0
		exactDistance := games.HaversineKm(guessLat, guessLng, answerLat, answerLng)
		exactScore := games.ComputeRoundScore("classic", "", exactDistance)
		classic := buildRound("经典", guessLat, guessLng, answerLat, answerLng, exactDistance)
		classic["score"] = exactScore
		cr := e.request(t, http.MethodPost, "/api/games", other, map[string]any{
			"mode": "classic", "totalScore": exactScore, "rounds": []any{classic},
		})
		if cr.status != http.StatusCreated {
			t.Fatalf("classic submit failed: %d %v", cr.status, cr.body)
		}

		// A pack game for the same player.
		play := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/play", other, nil)
		locationID := play.nestedArray("locations")[0].(map[string]any)["id"].(float64)
		packRound := buildPackRound("图包", locationID, 30, 100)
		pr := e.request(t, http.MethodPost, "/api/games", other, map[string]any{
			"mode": "pack", "totalScore": 0, "packId": id, "rounds": []any{packRound},
		})
		if pr.status != http.StatusCreated {
			t.Fatalf("pack submit failed: %d %v", pr.status, pr.body)
		}

		// Progress must still reflect only the classic game.
		summary := e.request(t, http.MethodGet, "/api/games/summary", other, nil)
		progress := summary.nestedMap("progress")
		if progress["totalRounds"] != float64(1) {
			t.Fatalf("expected progress totalRounds 1, got %v", progress)
		}
		// Profile stats must also ignore the pack game.
		profile := e.request(t, http.MethodGet, "/api/profile", other, nil)
		stats := profile.nestedMap("stats")
		if stats["totalGames"] != float64(1) {
			t.Fatalf("expected profile totalGames 1, got %v", stats)
		}
	})

	t.Run("pack game with foreign location rejected", func(t *testing.T) {
		id := createPack(owner, "越界图包", true)
		e.request(t, http.MethodPost, "/api/packs/"+strconv.FormatInt(id, 10)+"/locations", owner, map[string]any{
			"locations": []any{
				map[string]any{"name": "地点A", "lat": 30.0, "lng": 100.0, "difficulty": 1, "region": "asia", "imageId": "img-ffffffffffffffff"},
			},
		})
		play := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/play", other, nil)
		locationID := play.nestedArray("locations")[0].(map[string]any)["id"].(float64)

		resp := e.request(t, http.MethodPost, "/api/games", other, map[string]any{
			"mode": "pack", "totalScore": 0, "packId": id,
			"rounds": []any{map[string]any{
				"name": "错误地点", "locationId": locationID + 9999,
				"distanceKm": nil, "score": 0, "imageId": nil, "xp": 0, "difficulty": 1,
				"guessLat": 30, "guessLng": 100, "answerLat": nil, "answerLng": nil,
			}},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("pack game with client-claimed distance rejected", func(t *testing.T) {
		id := createPack(owner, "作弊图包", true)
		e.request(t, http.MethodPost, "/api/packs/"+strconv.FormatInt(id, 10)+"/locations", owner, map[string]any{
			"locations": []any{
				map[string]any{"name": "地点A", "lat": 30.0, "lng": 100.0, "difficulty": 1, "region": "asia", "imageId": "img-abcdef1234567890"},
			},
		})
		play := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/play", other, nil)
		locationID := play.nestedArray("locations")[0].(map[string]any)["id"].(float64)

		resp := e.request(t, http.MethodPost, "/api/games", other, map[string]any{
			"mode": "pack", "totalScore": 0, "packId": id,
			"rounds": []any{map[string]any{
				"name": "作弊", "locationId": locationID,
				"distanceKm": 10.0, "score": 0, "imageId": nil, "xp": 0, "difficulty": 1,
				"guessLat": 30, "guessLng": 100, "answerLat": nil, "answerLng": nil,
			}},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("pack mode without packId rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodPost, "/api/games", other, map[string]any{
			"mode": "pack", "totalScore": 0,
			"rounds": []any{map[string]any{
				"name": "X", "locationId": nil, "distanceKm": nil, "score": 0,
				"imageId": nil, "xp": 0, "difficulty": 1,
				"guessLat": 30, "guessLng": 100, "answerLat": nil, "answerLng": nil,
			}},
		})
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("private pack hidden from others", func(t *testing.T) {
		createPack(owner, "私有图包", false)
		resp := e.request(t, http.MethodGet, "/api/packs?mine=1", other, nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
		for _, raw := range resp.nestedArray("packs") {
			pack := raw.(map[string]any)
			if pack["name"] == "私有图包" {
				t.Fatal("private pack must not appear in another user's listing")
			}
		}
	})

	t.Run("non-owner cannot edit or delete", func(t *testing.T) {
		id := createPack(owner, "受保护图包", true)
		update := e.request(t, http.MethodPatch, "/api/packs/"+strconv.FormatInt(id, 10), other, map[string]any{
			"name": "篡改",
		})
		if update.status != http.StatusForbidden {
			t.Fatalf("expected 403, got %d: %v", update.status, update.body)
		}
		// Deleting a pack the caller does not own reports 404 so the pack's
		// existence stays hidden from non-owners.
		deleteResp := e.request(t, http.MethodDelete, "/api/packs/"+strconv.FormatInt(id, 10), other, nil)
		if deleteResp.status != http.StatusNotFound {
			t.Fatalf("expected 404, got %d: %v", deleteResp.status, deleteResp.body)
		}
	})

	t.Run("empty pack cannot be played", func(t *testing.T) {
		id := createPack(owner, "空图包", true)
		play := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10)+"/play", owner, nil)
		if play.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", play.status)
		}
	})

	t.Run("owner can delete pack", func(t *testing.T) {
		id := createPack(owner, "待删除图包", true)
		del := e.request(t, http.MethodDelete, "/api/packs/"+strconv.FormatInt(id, 10), owner, nil)
		if del.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", del.status)
		}
		get := e.request(t, http.MethodGet, "/api/packs/"+strconv.FormatInt(id, 10), owner, nil)
		if get.status != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", get.status)
		}
	})

	t.Run("unauth pack access rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/packs", "", nil)
		if resp.status != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.status)
		}
	})
}