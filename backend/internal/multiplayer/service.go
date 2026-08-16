package multiplayer

import (
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"sync"
	"time"

	"mma-guessr/backend/internal/auth"
	"mma-guessr/backend/internal/games"
	"mma-guessr/backend/internal/locations"
	"mma-guessr/backend/internal/ratelimit"
	"mma-guessr/backend/internal/util"
)

const (
	duelMaxScore        = 5000
	duelReferenceSpanKm = 2000.0
	duelBalanceFactor   = 2.3
	duelMinDistanceKm   = 30.0 / 1000

	roundSeconds     = 60
	matchmakerTickMS = 1500
	roomTTLSeconds   = 2 * 60 * 60
	eventRateWindow  = 10 * time.Second
	eventRateMax     = 20
)

// identity is the authenticated player bound to a connection.
type identity struct {
	role     string
	id       string
	username string
}

// socketState tracks one connected socket.
type socketState struct {
	sid      string
	identity *identity
	ip       string
	roomID   string
	rate     *ratelimit.SlidingWindow
}

// queueEntry is one player waiting for a match.
type queueEntry struct {
	SID      string
	PlayerID string
	Role     string
	Username string
	Mode     string
}

type playerState struct {
	SocketID        string   `json:"socketId"`
	PlayerID        string   `json:"playerId"`
	Role            string   `json:"role"`
	Username        string   `json:"username"`
	TotalScore      int      `json:"totalScore"`
	RoundScore      int      `json:"roundScore"`
	RoundDistanceKm *float64 `json:"roundDistanceKm"`
	HasAnswered     bool     `json:"hasAnswered"`
}

type roundResult struct {
	PlayerID   string   `json:"playerId"`
	DistanceKm *float64 `json:"distanceKm"`
	Score      int      `json:"score"`
}

type roundHistory struct {
	LocationID   int64         `json:"locationId"`
	LocationName string        `json:"locationName"`
	Results      []roundResult `json:"results"`
}

type room struct {
	id          string
	status      string
	roundIndex  int
	players     []playerState
	location    *locations.LocationRecord
	roundEndsAt time.Time
	rounds      []roundHistory
	timer       *time.Timer

	mu sync.Mutex
}

// Service implements the Socket.IO event layer (root namespace) on top of
// the Engine.IO polling transport.
type Service struct {
	engine    *EngineIO
	authStore *auth.Store
	locations *locations.Store
	games     *games.Service
	tokens    *auth.TokenService
	logger    *slog.Logger

	mu      sync.Mutex
	sockets map[string]*socketState
	queue   []queueEntry
	queued  map[string]bool
	rooms   map[string]*room
	ending  map[string]bool

	matchmaker *time.Ticker
	done       chan struct{}
}

// NewService creates the multiplayer service and starts the matchmaker.
func NewService(engine *EngineIO, authStore *auth.Store, locations *locations.Store,
	gamesSvc *games.Service, tokens *auth.TokenService, logger *slog.Logger) *Service {
	service := &Service{
		engine:    engine,
		authStore: authStore,
		locations: locations,
		games:     gamesSvc,
		tokens:    tokens,
		logger:    logger,
		sockets:   make(map[string]*socketState),
		queued:    make(map[string]bool),
		rooms:     make(map[string]*room),
		ending:    make(map[string]bool),
		done:      make(chan struct{}),
	}
	service.matchmaker = time.NewTicker(matchmakerTickMS * time.Millisecond)
	go service.tickLoop()
	return service
}

// Stop halts the matchmaker and room timers.
func (s *Service) Stop() {
	s.matchmaker.Stop()
	close(s.done)
}

// Transport returns the Engine.IO polling handler for HTTP mounting.
func (s *Service) Transport() http.Handler {
	return s.engine
}

func (s *Service) tickLoop() {
	for {
		select {
		case <-s.matchmaker.C:
			s.tickMatchmaker()
		case <-s.done:
			return
		}
	}
}

// OnSocketPacket decodes one socket.io packet.
func (s *Service) OnSocketPacket(sid, packet, clientIP string) {
	if packet == "" {
		return
	}
	switch packet[0] {
	case '0': // CONNECT
		s.handleConnect(sid, packet[1:], clientIP)
	case '1': // DISCONNECT
		s.handleDisconnect(sid)
	case '2': // EVENT
		s.handleEvent(sid, packet[1:])
	}
}

// OnSessionClose cleans up when the engine transport dies.
func (s *Service) OnSessionClose(sid string) {
	s.handleDisconnect(sid)
}

func (s *Service) handleConnect(sid, payload, clientIP string) {
	var authPayload struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal([]byte(payload), &authPayload)
	if authPayload.Token == "" {
		s.authReject(sid, "缺少身份令牌")
		return
	}
	claims, err := s.tokens.VerifyAccessToken(authPayload.Token)
	if err != nil {
		s.authReject(sid, "身份验证失败")
		return
	}
	username, err := s.resolveUsername(claims.Role, claims.Subject)
	if err != nil {
		s.authReject(sid, "身份信息解析失败")
		return
	}

	s.mu.Lock()
	s.sockets[sid] = &socketState{
		sid:      sid,
		identity: &identity{role: claims.Role, id: claims.Subject, username: username},
		ip:       clientIP,
	}
	s.mu.Unlock()

	connectAck, _ := json.Marshal(map[string]string{"sid": sid})
	s.engine.Send(sid, "40"+string(connectAck))
}

func (s *Service) authReject(sid, message string) {
	raw, _ := json.Marshal(map[string]string{"message": message})
	s.engine.Send(sid, "44"+string(raw))
	go func() {
		time.Sleep(300 * time.Millisecond)
		s.engine.Close(sid)
	}()
}

func (s *Service) resolveUsername(role, id string) (string, error) {
	if role == "user" {
		user, err := s.authStore.FindByID(id)
		if err != nil || user == nil {
			return "", err
		}
		return user.Username, nil
	}
	guest, err := s.authStore.GetGuest(id)
	if err != nil {
		return "", err
	}
	if guest == nil {
		return "游客_" + truncate4(id), nil
	}
	return guest.Username, nil
}

func (s *Service) handleEvent(sid, payload string) {
	var event []json.RawMessage
	if err := json.Unmarshal([]byte(payload), &event); err != nil || len(event) == 0 {
		return
	}
	var name string
	if err := json.Unmarshal(event[0], &name); err != nil {
		return
	}
	var args any
	if len(event) > 1 {
		_ = json.Unmarshal(event[1], &args)
	}

	switch name {
	case "mp:join":
		s.handleJoin(sid, args)
	case "mp:leave":
		s.handleLeave(sid)
	case "mp:answer":
		s.handleAnswer(sid, args)
	}
}

func (s *Service) socketOf(sid string) *socketState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sockets[sid]
}

// enforceEventRate limits per-IP+identity event traffic; violations kick.
func (s *Service) enforceEventRate(state *socketState) bool {
	if state == nil || state.identity == nil {
		return true
	}
	key := state.ip + ":" + state.identity.role + ":" + state.identity.id
	if state.rate == nil {
		state.rate = ratelimit.NewSlidingWindow(eventRateWindow, eventRateMax)
	}
	if state.rate.Allow(key) {
		return true
	}
	s.sendError(state.sid, "操作过于频繁，请稍后再试")
	s.engine.Close(state.sid)
	return false
}

func (s *Service) handleJoin(sid string, payload any) {
	state := s.socketOf(sid)
	if state == nil || state.identity == nil {
		return
	}
	if !s.enforceEventRate(state) {
		return
	}
	s.mu.Lock()
	if state.roomID != "" || s.queued[state.identity.id] {
		s.mu.Unlock()
		s.sendError(sid, "你已在队列或对局中")
		return
	}
	mode := "classic"
	if object, ok := payload.(map[string]any); ok {
		if raw, ok := object["mode"].(string); ok && raw != "" {
			mode = raw
		}
	}
	s.queue = append(s.queue, queueEntry{
		SID: sid, PlayerID: state.identity.id, Role: state.identity.role,
		Username: state.identity.username, Mode: mode,
	})
	s.queued[state.identity.id] = true
	position := len(s.queue)
	s.mu.Unlock()

	raw, _ := json.Marshal(map[string]any{"position": position})
	s.engine.Send(sid, "42"+`["mp:queued",`+string(raw)+`]`)
}

func (s *Service) handleLeave(sid string) {
	state := s.socketOf(sid)
	if state == nil {
		return
	}
	if !s.enforceEventRate(state) {
		return
	}
	s.mu.Lock()
	for i, entry := range s.queue {
		if entry.SID == sid {
			s.queue = append(s.queue[:i], s.queue[i+1:]...)
			delete(s.queued, entry.PlayerID)
			break
		}
	}
	s.mu.Unlock()
	s.engine.Send(sid, `42["mp:leftQueue"]`)
}

func (s *Service) tickMatchmaker() {
	s.mu.Lock()
	if len(s.queue) < 2 {
		s.mu.Unlock()
		return
	}
	second := s.queue[len(s.queue)-1]
	first := s.queue[len(s.queue)-2]
	s.queue = s.queue[:len(s.queue)-2]
	s.mu.Unlock()

	firstAlive := s.engine.HasSession(first.SID)
	secondAlive := s.engine.HasSession(second.SID)
	if !firstAlive && !secondAlive {
		delete(s.queued, first.PlayerID)
		delete(s.queued, second.PlayerID)
		return
	}
	if !firstAlive || !secondAlive {
		s.mu.Lock()
		if firstAlive {
			s.queue = append(s.queue, first)
		} else {
			delete(s.queued, first.PlayerID)
		}
		if secondAlive {
			s.queue = append(s.queue, second)
		} else {
			delete(s.queued, second.PlayerID)
		}
		s.mu.Unlock()
		return
	}
	s.createRoom(first, second)
}

func (s *Service) createRoom(entryA, entryB queueEntry) {
	roomID := util.NewUUID()
	newRoom := &room{
		id:     roomID,
		status: "playing",
		players: []playerState{
			toPlayerState(entryA),
			toPlayerState(entryB),
		},
	}
	s.mu.Lock()
	s.rooms[roomID] = newRoom
	delete(s.queued, entryA.PlayerID)
	delete(s.queued, entryB.PlayerID)
	if stateA := s.sockets[entryA.SID]; stateA != nil {
		stateA.roomID = roomID
	}
	if stateB := s.sockets[entryB.SID]; stateB != nil {
		stateB.roomID = roomID
	}
	s.mu.Unlock()

	matchedA, _ := json.Marshal(map[string]any{"roomId": roomID, "mode": "duel", "opponentUsername": entryB.Username})
	matchedB, _ := json.Marshal(map[string]any{"roomId": roomID, "mode": "duel", "opponentUsername": entryA.Username})
	s.engine.Send(entryA.SID, "42"+`["mp:matched",`+string(matchedA)+`]`)
	s.engine.Send(entryB.SID, "42"+`["mp:matched",`+string(matchedB)+`]`)
	s.startRound(roomID)
}

func toPlayerState(entry queueEntry) playerState {
	return playerState{
		SocketID: entry.SID, PlayerID: entry.PlayerID, Role: entry.Role,
		Username: entry.Username,
	}
}

func (s *Service) startRound(roomID string) {
	current := s.roomOf(roomID)
	if current == nil || current.status != "playing" {
		return
	}
	current.mu.Lock()
	defer current.mu.Unlock()
	if current.status != "playing" {
		return
	}

	drawn, err := s.locations.GetRandomLocations(locations.RandomLocationsQuery{Count: 1})
	if err != nil || len(drawn) == 0 {
		s.abortRoom(roomID, "题目池为空，对局中止")
		return
	}
	location := drawn[0]
	current.location = &location
	current.roundEndsAt = time.Now().Add(roundSeconds * time.Second)
	for i := range current.players {
		current.players[i].RoundScore = 0
		current.players[i].RoundDistanceKm = nil
		current.players[i].HasAnswered = false
	}

	roundPayload := struct {
		RoundIndex  int `json:"roundIndex"`
		TotalRounds int `json:"totalRounds"`
		TimeLimitMs int `json:"timeLimitMs"`
		Location    any `json:"location"`
	}{
		RoundIndex:  current.roundIndex,
		TotalRounds: 5,
		TimeLimitMs: roundSeconds * 1000,
		Location: map[string]any{
			"panoramaUrl": location.PanoramaURL,
			"mapillaryId": location.MapillaryID,
		},
	}
	raw, _ := json.Marshal(roundPayload)
	s.emitToRoom(roomID, "42"+`["mp:round",`+string(raw)+`]`)

	current.timer = time.AfterFunc(roundSeconds*time.Second, func() {
		s.endRound(roomID)
	})
}

func (s *Service) handleAnswer(sid string, payload any) {
	state := s.socketOf(sid)
	if state == nil {
		return
	}
	if !s.enforceEventRate(state) {
		return
	}
	if state.roomID == "" {
		s.sendError(sid, "你不在对局中")
		return
	}
	body, ok := payload.(map[string]any)
	if !ok {
		return
	}
	claimedRound := int(-1)
	if index, ok := body["roundIndex"].(float64); ok {
		claimedRound = int(index)
	}
	guessLat, latOK := body["guessLat"].(float64)
	guessLng, lngOK := body["guessLng"].(float64)
	if !latOK || !lngOK || !finite(guessLat) || !finite(guessLng) ||
		guessLat < -90 || guessLat > 90 || guessLng < -180 || guessLng > 180 {
		s.sendError(sid, "无效的坐标提交")
		return
	}

	current := s.roomOf(state.roomID)
	if current == nil || current.status != "playing" {
		return
	}
	current.mu.Lock()
	if current.status != "playing" || current.location == nil {
		current.mu.Unlock()
		return
	}
	if claimedRound != -1 && claimedRound != current.roundIndex {
		current.mu.Unlock()
		return
	}
	answeredCount := 0
	found := false
	for i := range current.players {
		player := &current.players[i]
		if player.SocketID == sid {
			if player.HasAnswered {
				found = true
				break
			}
			distance := HaversineDuel(guessLat, guessLng, current.location.Lat, current.location.Lng)
			score := computeDuelScore(distance)
			player.RoundDistanceKm = &distance
			player.RoundScore = score
			player.TotalScore += score
			player.HasAnswered = true
			found = true
		}
		if player.HasAnswered {
			answeredCount++
		}
	}
	allAnswered := answeredCount == len(current.players)
	current.mu.Unlock()
	if found && allAnswered {
		s.endRound(state.roomID)
	}
}

// HaversineDuel mirrors games.HaversineKm for duel scoring.
func HaversineDuel(latA, lngA, latB, lngB float64) float64 {
	const radiusKm = 6378.137
	const degToRad = math.Pi / 180
	latARad := latA * degToRad
	latBRad := latB * degToRad
	dLat := (latB - latA) * degToRad
	dLng := (lngB - lngA) * degToRad
	sinLat := math.Sin(dLat / 2)
	sinLng := math.Sin(dLng / 2)
	a := sinLat*sinLat + math.Cos(latARad)*math.Cos(latBRad)*sinLng*sinLng
	clamped := math.Max(0, math.Min(1, a))
	c := 2 * math.Atan2(math.Sqrt(clamped), math.Sqrt(1-clamped))
	return radiusKm * c
}

func computeDuelScore(distanceKm float64) int {
	effective := math.Max(distanceKm, duelMinDistanceKm)
	span := duelReferenceSpanKm * duelBalanceFactor
	score := math.Round(duelMaxScore * math.Exp(-10*effective/span))
	return int(math.Max(0, math.Min(duelMaxScore, score)))
}

// endRound settles the current round (answer-triggered or timeout).
func (s *Service) endRound(roomID string) {
	s.mu.Lock()
	if s.ending[roomID] {
		s.mu.Unlock()
		return
	}
	s.ending[roomID] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.ending, roomID)
		s.mu.Unlock()
	}()

	current := s.roomOf(roomID)
	if current == nil || current.status != "playing" {
		return
	}
	current.mu.Lock()
	if current.timer != nil {
		current.timer.Stop()
		current.timer = nil
	}
	if current.status != "playing" || current.location == nil {
		current.mu.Unlock()
		return
	}
	history := toRoundHistory(current)
	current.rounds = append(current.rounds, history)
	lastRound := current.roundIndex
	nextIndex := lastRound + 1
	location := *current.location
	current.mu.Unlock()

	endPayload := struct {
		RoundIndex int           `json:"roundIndex"`
		Answer     any           `json:"answer"`
		Results    []roundResult `json:"results"`
	}{
		RoundIndex: lastRound,
		Answer:     map[string]any{"name": location.Name, "lat": location.Lat, "lng": location.Lng},
		Results:    history.Results,
	}
	raw, _ := json.Marshal(endPayload)
	s.emitToRoom(roomID, "42"+`["mp:roundEnd",`+string(raw)+`]`)

	if nextIndex < 5 {
		current.mu.Lock()
		current.roundIndex = nextIndex
		current.mu.Unlock()
		s.startRound(roomID)
		return
	}
	s.finishRoom(roomID)
}

func toRoundHistory(current *room) roundHistory {
	history := roundHistory{Results: make([]roundResult, 0, len(current.players))}
	if current.location != nil {
		history.LocationID = current.location.ID
		history.LocationName = current.location.Name
	}
	for _, player := range current.players {
		history.Results = append(history.Results, roundResult{
			PlayerID: player.PlayerID, DistanceKm: player.RoundDistanceKm, Score: player.RoundScore,
		})
	}
	return history
}

func (s *Service) finishRoom(roomID string) {
	current := s.roomOf(roomID)
	if current == nil || current.status != "playing" {
		return
	}
	current.mu.Lock()
	current.status = "finished"
	rounds := make([]roundHistory, len(current.rounds))
	copy(rounds, current.rounds)
	players := make([]playerState, len(current.players))
	copy(players, current.players)
	current.mu.Unlock()

	// Persist before notifying so the client always finds its record.
	s.recordDuelGames(players, rounds)

	rankings := make([]playerState, len(players))
	copy(rankings, players)
	sortByScoreDesc(rankings)
	rankPayload := struct {
		Rankings []map[string]any `json:"rankings"`
	}{}
	for _, player := range rankings {
		rankPayload.Rankings = append(rankPayload.Rankings, map[string]any{
			"playerId": player.PlayerID, "username": player.Username, "totalScore": player.TotalScore,
		})
	}
	raw, _ := json.Marshal(rankPayload)
	s.emitToRoom(roomID, "42"+`["mp:finished",`+string(raw)+`]`)

	// Keep the room around briefly for late disconnects, then drop it.
	time.AfterFunc(roomTTLSeconds*time.Second, func() {
		s.mu.Lock()
		delete(s.rooms, roomID)
		s.mu.Unlock()
	})
}

func (s *Service) recordDuelGames(players []playerState, rounds []roundHistory) {
	for _, player := range players {
		gameRounds := make([]games.GameRound, 0, len(rounds))
		for _, history := range rounds {
			var result *roundResult
			for i := range history.Results {
				if history.Results[i].PlayerID == player.PlayerID {
					result = &history.Results[i]
					break
				}
			}
			locationID := history.LocationID
			round := games.GameRound{
				Name:       history.LocationName,
				LocationID: &locationID,
				Score:      0,
				Difficulty: 1,
			}
			if result != nil {
				round.DistanceKm = result.DistanceKm
				round.Score = result.Score
			}
			gameRounds = append(gameRounds, round)
		}
		_, err := s.games.SubmitGame(games.PlayerRef{Role: player.Role, ID: player.PlayerID}, games.SubmitGameInput{
			Mode: "duel", TotalScore: player.TotalScore, Rounds: gameRounds,
		})
		if err != nil {
			s.logger.Warn("duel record failed", "player", player.PlayerID, "error", err)
		}
	}
}

func (s *Service) abortRoom(roomID, reason string) {
	s.sendError(roomID, reason)
	s.mu.Lock()
	delete(s.rooms, roomID)
	s.mu.Unlock()
}

func (s *Service) handleDisconnect(sid string) {
	s.mu.Lock()
	state := s.sockets[sid]
	if state != nil {
		delete(s.sockets, sid)
		if state.identity != nil {
			delete(s.queued, state.identity.id)
			// Remove any queue entry belonging to this socket.
			for i := 0; i < len(s.queue); i++ {
				if s.queue[i].SID == sid {
					s.queue = append(s.queue[:i], s.queue[i+1:]...)
					i--
				}
			}
		}
	}
	roomID := ""
	if state != nil {
		roomID = state.roomID
	}
	s.mu.Unlock()
	if roomID == "" {
		return
	}
	current := s.roomOf(roomID)
	if current == nil || current.status != "playing" {
		return
	}
	current.mu.Lock()
	if current.timer != nil {
		current.timer.Stop()
	}
	current.mu.Unlock()

	s.emitToRoom(roomID, `42["mp:opponentLeft",{"reason":"对手已离开，对局中止"}]`)
	s.mu.Lock()
	delete(s.rooms, roomID)
	s.mu.Unlock()
}

func (s *Service) sendError(target, message string) {
	raw, _ := json.Marshal(map[string]string{"message": message})
	frame := "42" + `["mp:error",` + string(raw) + `]`
	if current := s.roomOf(target); current != nil {
		s.emitToRoom(target, frame)
		return
	}
	s.engine.Send(target, frame)
}

func (s *Service) roomOf(roomID string) *room {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rooms[roomID]
}

func (s *Service) emitToRoom(roomID string, frame string) {
	s.mu.Lock()
	current := s.rooms[roomID]
	if current == nil {
		s.mu.Unlock()
		return
	}
	targets := make([]string, 0, len(current.players))
	for _, player := range current.players {
		targets = append(targets, player.SocketID)
	}
	s.mu.Unlock()
	for _, sid := range targets {
		s.engine.Send(sid, frame)
	}
}

func sortByScoreDesc(players []playerState) {
	for i := 1; i < len(players); i++ {
		for j := i; j > 0 && players[j].TotalScore > players[j-1].TotalScore; j-- {
			players[j], players[j-1] = players[j-1], players[j]
		}
	}
}

func truncate4(value string) string {
	if len(value) >= 4 {
		return value[:4]
	}
	return value
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
