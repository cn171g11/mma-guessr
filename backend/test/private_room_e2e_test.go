package e2e

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestMultiplayerPrivateRoom(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(20)

	guestA := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
	guestB := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)

	clientA := newEIOClient(t, e.ts.URL)
	clientB := newEIOClient(t, e.ts.URL)
	clientA.connect(guestA.str("guestToken"))
	clientB.connect(guestB.str("guestToken"))

	var roomCode string
	t.Run("host creates a private room", func(t *testing.T) {
		clientA.emit("mp:createPrivate", nil)
		raw := clientA.expectEvent("mp:privateCreated", 3*time.Second)
		if raw == nil {
			t.Fatal("host never received mp:privateCreated")
		}
		var created struct {
			RoomCode string `json:"roomCode"`
		}
		if err := json.Unmarshal(raw, &created); err != nil {
			t.Fatalf("parse privateCreated: %v", err)
		}
		if len(created.RoomCode) != 6 {
			t.Fatalf("expected 6-char room code, got %q", created.RoomCode)
		}
		roomCode = created.RoomCode
	})

	t.Run("guest cannot join a bogus code", func(t *testing.T) {
		clientB.emit("mp:join", map[string]any{"mode": "private", "roomCode": "ZZZZZZ"})
		if raw := clientB.expectEvent("mp:error", 3*time.Second); raw == nil {
			t.Fatal("guest never saw mp:error for a bogus code")
		}
	})

	t.Run("guest joins with the code and a duel starts", func(t *testing.T) {
		clientB.emit("mp:join", map[string]any{"mode": "private", "roomCode": roomCode})

		rawA := clientA.expectEvent("mp:matched", 5*time.Second)
		rawB := clientB.expectEvent("mp:matched", 5*time.Second)
		if rawA == nil || rawB == nil {
			t.Fatal("players never matched in the private room")
		}
		var matchedA struct {
			RoomID           string `json:"roomId"`
			Mode             string `json:"mode"`
			OpponentUsername string `json:"opponentUsername"`
		}
		if err := json.Unmarshal(rawA, &matchedA); err != nil {
			t.Fatalf("parse matched: %v", err)
		}
		if matchedA.Mode != "duel" || matchedA.RoomID == "" {
			t.Fatalf("unexpected match payload %+v", matchedA)
		}

		roundA := clientA.expectEvent("mp:round", 5*time.Second)
		roundB := clientB.expectEvent("mp:round", 5*time.Second)
		if roundA == nil || roundB == nil {
			t.Fatal("private duel never started a round")
		}

		answer := map[string]any{"guessLat": 30.0, "guessLng": 100.0, "roundIndex": 0}
		clientA.emit("mp:answer", answer)
		clientB.emit("mp:answer", answer)

		if clientA.expectEvent("mp:roundEnd", 5*time.Second) == nil {
			t.Fatal("host never saw mp:roundEnd")
		}
		if clientB.expectEvent("mp:roundEnd", 5*time.Second) == nil {
			t.Fatal("guest never saw mp:roundEnd")
		}
	})

	t.Run("rejoining while in a room is rejected", func(t *testing.T) {
		clientB.emit("mp:join", map[string]any{"mode": "private", "roomCode": roomCode})
		if raw := clientB.expectEvent("mp:error", 3*time.Second); raw == nil {
			t.Fatal("guest should not join twice")
		}
	})
}