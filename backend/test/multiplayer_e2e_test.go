package e2e

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// eioClient is a minimal Engine.IO v4 polling client used to exercise the
// server exactly like the real socket.io 4.8.1 client.
type eioClient struct {
	t       *testing.T
	baseURL string
	sid     string
	recv    chan string
	httpc   *http.Client
	done    chan struct{}
	ctx     context.Context
	cancel  context.CancelFunc
}

func newEIOClient(t *testing.T, baseURL string) *eioClient {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	client := &eioClient{
		t:       t,
		baseURL: baseURL,
		recv:    make(chan string, 64),
		httpc:   &http.Client{},
		done:    make(chan struct{}),
		ctx:     ctx,
		cancel:  cancel,
	}
	// Handshake.
	body := client.get("/socket.io/?EIO=4&transport=polling&t=1")
	if len(body) < 2 || body[0] != '0' {
		t.Fatalf("unexpected handshake: %q", body)
	}
	var handshake struct {
		Sid string `json:"sid"`
	}
	if err := json.Unmarshal([]byte(body[1:]), &handshake); err != nil {
		t.Fatalf("parse handshake: %v (%q)", err, body)
	}
	client.sid = handshake.Sid
	t.Cleanup(client.close)
	go client.pollLoop()
	return client
}

// get performs one polling GET. On transport error or non-200 it returns ""
// (the caller retries); t.Fatalf is only called while the client is still
// active so background polls never panic after the test has completed.
func (c *eioClient) get(url string) string {
	c.t.Helper()
	req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, c.baseURL+url, nil)
	if err != nil {
		return ""
	}
	resp, err := c.httpc.Do(req)
	if err != nil {
		select {
		case <-c.done:
		default:
			c.t.Fatalf("poll failed: %v", err)
		}
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return ""
	}
	raw, _ := io.ReadAll(resp.Body)
	return string(raw)
}

func (c *eioClient) post(frame string) {
	c.t.Helper()
	req, err := http.NewRequestWithContext(c.ctx, http.MethodPost, c.baseURL+"/socket.io/?EIO=4&transport=polling&sid="+c.sid,
		strings.NewReader(frame))
	if err != nil {
		return
	}
	resp, err := c.httpc.Do(req)
	if err != nil {
		select {
		case <-c.done:
		default:
			c.t.Fatalf("post failed: %v", err)
		}
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
}

// pollLoop keeps a long-poll open; engine.io frames are pushed to recv and
// pings answered with pongs. It returns as soon as the client is closed so
// that t.Cleanup never leaves stray goroutines panicking.
func (c *eioClient) pollLoop() {
	for {
		select {
		case <-c.done:
			return
		default:
		}
		raw := c.get("/socket.io/?EIO=4&transport=polling&sid=" + c.sid)
		if raw == "" {
			select {
			case <-c.done:
				return
			default:
			}
			time.Sleep(20 * time.Millisecond)
			continue
		}
		for _, frame := range strings.Split(raw, "\x1e") {
			if frame == "" {
				continue
			}
			if frame[0] == '2' { // server ping → pong
				c.post("3")
				continue
			}
			select {
			case c.recv <- frame:
			default:
			}
		}
	}
}

// connect sends the socket.io CONNECT packet with auth and waits for the ack.
func (c *eioClient) connect(token string) {
	c.t.Helper()
	payload, _ := json.Marshal(map[string]string{"token": token})
	c.post("40" + string(payload))
	if !c.expectPrefix("40", 3*time.Second) {
		c.t.Fatal("socket.io connect ack not received")
	}
}

// emit sends a socket.io EVENT packet.
func (c *eioClient) emit(event string, payload any) {
	c.t.Helper()
	args := []any{event}
	if payload != nil {
		args = append(args, payload)
	}
	raw, _ := json.Marshal(args)
	c.post("42" + string(raw))
}

// expectEvent waits for an event frame `42["name",...]` matching the event
// name and returns its arguments as JSON bytes.
func (c *eioClient) expectEvent(name string, timeout time.Duration) []byte {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case frame := <-c.recv:
			if !strings.HasPrefix(frame, "42") {
				continue
			}
			var parts []json.RawMessage
			if err := json.Unmarshal([]byte(frame[2:]), &parts); err != nil || len(parts) < 1 {
				continue
			}
			var eventName string
			if err := json.Unmarshal(parts[0], &eventName); err != nil || eventName != name {
				continue
			}
			if len(parts) > 1 {
				return parts[1]
			}
			// Event received with no arguments: return a non-nil empty
			// payload so callers can distinguish "found" from a timeout.
			return []byte{}
		case <-c.done:
			return nil
		}
	}
	return nil
}

func (c *eioClient) expectPrefix(prefix string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case frame := <-c.recv:
			if strings.HasPrefix(frame, prefix) {
				return true
			}
		case <-c.done:
			return false
		}
	}
	return false
}

func (c *eioClient) close() {
	c.cancel() // abort any in-flight poll/post
	select {
	case <-c.done:
	default:
		close(c.done)
	}
}

func TestMultiplayerDuel(t *testing.T) {
	e := newTestEnv(t)
	e.seedLocations(50)

	guestA := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
	guestB := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)

	clientA := newEIOClient(t, e.ts.URL)
	clientB := newEIOClient(t, e.ts.URL)
	clientA.connect(guestA.str("guestToken"))
	clientB.connect(guestB.str("guestToken"))

	t.Run("join queues both players", func(t *testing.T) {
		clientA.emit("mp:join", map[string]any{"mode": "duel"})
		clientB.emit("mp:join", map[string]any{"mode": "duel"})

		if raw := clientA.expectEvent("mp:queued", 3*time.Second); raw == nil {
			t.Fatal("player A never queued")
		}
		if raw := clientB.expectEvent("mp:queued", 3*time.Second); raw == nil {
			t.Fatal("player B never queued")
		}
	})

	var roomID string
	var opponentB string
	t.Run("matchmaker pairs the players", func(t *testing.T) {
		rawA := clientA.expectEvent("mp:matched", 5*time.Second)
		if rawA == nil {
			t.Fatal("player A never matched")
		}
		rawB := clientB.expectEvent("mp:matched", 5*time.Second)
		if rawB == nil {
			t.Fatal("player B never matched")
		}
		var matchedA struct {
			RoomID           string `json:"roomId"`
			Mode             string `json:"mode"`
			OpponentUsername string `json:"opponentUsername"`
		}
		if err := json.Unmarshal(rawA, &matchedA); err != nil {
			t.Fatalf("parse matched: %v", err)
		}
		roomID = matchedA.RoomID
		opponentB = matchedA.OpponentUsername
		if matchedA.Mode != "duel" {
			t.Fatalf("unexpected mode %s", matchedA.Mode)
		}
	})

	t.Run("five rounds with answers settle and finish", func(t *testing.T) {
		myID := guestA.str("guestId")
		for round := 0; round < 5; round++ {
			roundA := clientA.expectEvent("mp:round", 5*time.Second)
			roundB := clientB.expectEvent("mp:round", 5*time.Second)
			if roundA == nil || roundB == nil {
				t.Fatalf("round %d never started", round)
			}
			var roundPayload struct {
				RoundIndex  int `json:"roundIndex"`
				TotalRounds int `json:"totalRounds"`
				TimeLimitMs int `json:"timeLimitMs"`
				Location    struct {
					PanoramaURL string `json:"panoramaUrl"`
					MapillaryID string `json:"mapillaryId"`
				} `json:"location"`
			}
			if err := json.Unmarshal(roundA, &roundPayload); err != nil {
				t.Fatalf("parse round: %v", err)
			}
			if roundPayload.RoundIndex != round || roundPayload.TotalRounds != 5 ||
				roundPayload.TimeLimitMs != 60000 {
				t.Fatalf("unexpected round payload %+v", roundPayload)
			}
			if roundPayload.Location.MapillaryID != "" || roundPayload.Location.PanoramaURL != "" {
				// The round must NOT leak the answer coordinates.
				var leak struct {
					Location map[string]any `json:"location"`
				}
				_ = json.Unmarshal(roundA, &leak)
				if _, hasLat := leak.Location["lat"]; hasLat {
					t.Fatal("mp:round leaked answer coordinates")
				}
			}

			answer := map[string]any{
				"guessLat":   30 + float64(round),
				"guessLng":   100 + float64(round),
				"roundIndex": round,
			}
			clientA.emit("mp:answer", answer)
			clientB.emit("mp:answer", answer)

			endA := clientA.expectEvent("mp:roundEnd", 5*time.Second)
			endB := clientB.expectEvent("mp:roundEnd", 5*time.Second)
			if endA == nil || endB == nil {
				t.Fatalf("round %d never ended", round)
			}
			var endPayload struct {
				RoundIndex int `json:"roundIndex"`
				Answer     struct {
					Name string  `json:"name"`
					Lat  float64 `json:"lat"`
					Lng  float64 `json:"lng"`
				} `json:"answer"`
				Results []struct {
					PlayerID   string   `json:"playerId"`
					DistanceKm *float64 `json:"distanceKm"`
					Score      int      `json:"score"`
				} `json:"results"`
			}
			if err := json.Unmarshal(endA, &endPayload); err != nil {
				t.Fatalf("parse roundEnd: %v", err)
			}
			if endPayload.RoundIndex != round || len(endPayload.Results) != 2 {
				t.Fatalf("unexpected roundEnd %+v", endPayload)
			}
			if endPayload.Answer.Lat == 0 && endPayload.Answer.Lng == 0 {
				t.Fatal("roundEnd must reveal the answer")
			}
		}

		finished := clientA.expectEvent("mp:finished", 5*time.Second)
		if finished == nil {
			t.Fatal("player A never saw mp:finished")
		}
		if clientB.expectEvent("mp:finished", 5*time.Second) == nil {
			t.Fatal("player B never saw mp:finished")
		}
		var finishPayload struct {
			Rankings []struct {
				PlayerID   string `json:"playerId"`
				Username   string `json:"username"`
				TotalScore int    `json:"totalScore"`
			} `json:"rankings"`
		}
		if err := json.Unmarshal(finished, &finishPayload); err != nil {
			t.Fatalf("parse finished: %v", err)
		}
		if len(finishPayload.Rankings) != 2 {
			t.Fatalf("expected 2 rankings, got %d", len(finishPayload.Rankings))
		}
		// Both players answered identically, so scores must match.
		if finishPayload.Rankings[0].TotalScore != finishPayload.Rankings[1].TotalScore {
			t.Fatalf("identical answers should tie: %+v", finishPayload.Rankings)
		}
		_ = myID
		_ = roomID
		_ = opponentB
	})

	t.Run("duel games persisted", func(t *testing.T) {
		deadline := time.Now().Add(5 * time.Second)
		var count int
		for time.Now().Before(deadline) {
			_ = e.conn.QueryRow(`SELECT COUNT(*) FROM game_results WHERE mode = 'duel'`).Scan(&count)
			if count == 2 {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if count != 2 {
			t.Fatalf("expected 2 duel games persisted, got %d", count)
		}
	})

	t.Run("join before match leaves queue", func(t *testing.T) {
		guestC := e.request(t, http.MethodPost, "/api/auth/guest", "", nil)
		clientC := newEIOClient(t, e.ts.URL)
		clientC.connect(guestC.str("guestToken"))
		clientC.emit("mp:join", map[string]any{"mode": "duel"})
		if clientC.expectEvent("mp:queued", 3*time.Second) == nil {
			t.Fatal("player C never queued")
		}
		clientC.emit("mp:leave", nil)
		if clientC.expectEvent("mp:leftQueue", 3*time.Second) == nil {
			t.Fatal("player C never left the queue")
		}
	})
}

func TestMultiplayerAuthRejection(t *testing.T) {
	e := newTestEnv(t)

	t.Run("connect without token rejected", func(t *testing.T) {
		client := newEIOClient(t, e.ts.URL)
		payload, _ := json.Marshal(map[string]string{})
		client.post("40" + string(payload))
		if !client.expectPrefix("44", 3*time.Second) {
			t.Fatal("expected connect error 44")
		}
		client.close()
	})

	t.Run("connect with forged token rejected", func(t *testing.T) {
		client := newEIOClient(t, e.ts.URL)
		payload, _ := json.Marshal(map[string]string{"token": "forged"})
		client.post("40" + string(payload))
		if !client.expectPrefix("44", 3*time.Second) {
			t.Fatal("expected connect error 44")
		}
		client.close()
	})
}
