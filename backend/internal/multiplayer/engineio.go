package multiplayer

import (
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"mma-guessr/backend/internal/util"
)

// engine.io protocol constants (v4 polling).
const (
	eoOpen    = "0"
	eoClose   = "1"
	eoPing    = "2"
	eoPong    = "3"
	eoMessage = "4"

	frameSeparator = "\x1e"
	maxPayload     = 1_000_000
)

// engineIOHandler receives decoded socket.io packets and lifecycle events.
type engineIOHandler interface {
	OnSocketPacket(sid string, packet string, clientIP string)
	OnSessionClose(sid string)
}

// engineSession is the server-side polling session state.
type engineSession struct {
	sid      string
	socketID string
	outbound []string
	waiters  []chan struct{}
	lastPong time.Time
	closed   bool
}

// EngineIO is a minimal Engine.IO v4 polling-only server. It accepts the
// handshake, long-polls queued frames and decodes client frames.
type EngineIO struct {
	mu           sync.Mutex
	sessions     map[string]*engineSession
	pingInterval time.Duration
	pingTimeout  time.Duration
	pollHold     time.Duration
	handler      engineIOHandler
	logger       *slog.Logger
}

// NewEngineIO creates the polling transport server.
func NewEngineIO(logger *slog.Logger) *EngineIO {
	return &EngineIO{
		sessions:     make(map[string]*engineSession),
		pingInterval: 25 * time.Second,
		pingTimeout:  20 * time.Second,
		pollHold:     20 * time.Second,
		logger:       logger,
	}
}

// SetHandler wires the socket.io layer after construction.
func (e *EngineIO) SetHandler(handler engineIOHandler) {
	e.handler = handler
}

// ServeHTTP handles Engine.IO GET (poll) and POST (data) requests.
func (e *EngineIO) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sid := r.URL.Query().Get("sid")
	switch r.Method {
	case http.MethodGet:
		e.handlePoll(w, r, sid)
	case http.MethodPost:
		e.handlePost(w, r, sid)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (e *EngineIO) handlePoll(w http.ResponseWriter, r *http.Request, sid string) {
	if sid == "" {
		e.handshake(w, r)
		return
	}
	frames, ok := e.drain(sid)
	if !ok {
		http.Error(w, "unknown sid", http.StatusBadRequest)
		return
	}
	if len(frames) > 0 {
		writeFrames(w, frames)
		return
	}
	// Long-poll: hold until a frame arrives or the hold period elapses.
	waiter := e.waitForData(sid)
	if waiter == nil {
		http.Error(w, "unknown sid", http.StatusBadRequest)
		return
	}
	select {
	case <-waiter:
		frames, _ := e.drain(sid)
		writeFrames(w, frames)
	case <-time.After(e.pollHold):
		w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
		w.WriteHeader(http.StatusOK)
	case <-r.Context().Done():
		e.dropWaiter(sid, waiter)
	}
}

func (e *EngineIO) handshake(w http.ResponseWriter, _ *http.Request) {
	sid := util.NewUUID()
	session := &engineSession{sid: sid, socketID: util.NewUUID(), lastPong: time.Now()}
	e.mu.Lock()
	e.sessions[sid] = session
	e.mu.Unlock()

	payload := eoOpen + `{"sid":"` + sid + `","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":` +
		string(maxPayloadStr) + `}`
	w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(payload))
	go e.pingLoop(sid)
}

func (e *EngineIO) handlePost(w http.ResponseWriter, r *http.Request, sid string) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPayload+1))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if len(body) > maxPayload {
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}

	for _, frame := range strings.Split(string(body), frameSeparator) {
		if frame == "" {
			continue
		}
		e.handleFrame(sid, frame, clientIPOf(r))
	}
	w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func clientIPOf(r *http.Request) string {
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	return host
}

func (e *EngineIO) handleFrame(sid, frame, clientIP string) {
	switch frame[0] {
	case eoClose[0]:
		e.closeSession(sid)
	case eoPing[0]:
		e.enqueue(sid, eoPong)
	case eoPong[0]:
		e.mu.Lock()
		if session := e.sessions[sid]; session != nil {
			session.lastPong = time.Now()
		}
		e.mu.Unlock()
	case eoMessage[0]:
		if len(frame) > 1 {
			e.handler.OnSocketPacket(sid, frame[1:], clientIP)
		}
	}
}

func (e *EngineIO) pingLoop(sid string) {
	ticker := time.NewTicker(e.pingInterval)
	defer ticker.Stop()
	for range ticker.C {
		expired := false
		e.mu.Lock()
		session := e.sessions[sid]
		if session == nil {
			e.mu.Unlock()
			return
		}
		if time.Since(session.lastPong) > e.pingTimeout {
			session.closed = true
			expired = true
		}
		e.mu.Unlock()
		if expired {
			e.closeSession(sid)
			return
		}
		e.enqueue(sid, eoPing)
	}
}

func (e *EngineIO) enqueue(sid string, frames ...string) {
	e.mu.Lock()
	session := e.sessions[sid]
	if session == nil || session.closed {
		e.mu.Unlock()
		return
	}
	session.outbound = append(session.outbound, frames...)
	waiters := session.waiters
	session.waiters = nil
	for _, waiter := range waiters {
		close(waiter)
	}
	e.mu.Unlock()
}

// Send queues an engine.io frame to a session (server→client).
func (e *EngineIO) Send(sid string, frame string) {
	e.enqueue(sid, frame)
}

// Close terminates a session (client disconnect or server abort).
func (e *EngineIO) Close(sid string) {
	e.closeSession(sid)
}

func (e *EngineIO) closeSession(sid string) {
	e.mu.Lock()
	session := e.sessions[sid]
	if session == nil || session.closed {
		e.mu.Unlock()
		return
	}
	session.closed = true
	delete(e.sessions, sid)
	waiters := session.waiters
	session.waiters = nil
	e.mu.Unlock()
	// Wake any long-poll so a closed session never hangs until pollHold.
	for _, waiter := range waiters {
		close(waiter)
	}
	e.handler.OnSessionClose(sid)
}

func (e *EngineIO) drain(sid string) ([]string, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	session := e.sessions[sid]
	if session == nil || session.closed {
		return nil, false
	}
	frames := session.outbound
	session.outbound = nil
	return frames, true
}

func (e *EngineIO) waitForData(sid string) chan struct{} {
	e.mu.Lock()
	defer e.mu.Unlock()
	session := e.sessions[sid]
	if session == nil || session.closed {
		return nil
	}
	waiter := make(chan struct{})
	session.waiters = append(session.waiters, waiter)
	return waiter
}

func (e *EngineIO) dropWaiter(sid string, waiter chan struct{}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	session := e.sessions[sid]
	if session == nil {
		return
	}
	for i, existing := range session.waiters {
		if existing == waiter {
			session.waiters = append(session.waiters[:i], session.waiters[i+1:]...)
			return
		}
	}
}

// HasSession reports whether a session is still connected (used by
// matchmaking to skip vanished sockets).
func (e *EngineIO) HasSession(sid string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	session := e.sessions[sid]
	return session != nil && !session.closed
}

func writeFrames(w http.ResponseWriter, frames []string) {
	w.Header().Set("Content-Type", "text/plain; charset=UTF-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(strings.Join(frames, frameSeparator)))
}

var maxPayloadStr = []byte("1000000")
