package auth

import (
	"sync"
	"time"
)

// loginEntry tracks consecutive login failures and the lock expiry.
type loginEntry struct {
	failCount   int
	firstAt     time.Time
	lockedUntil time.Time
}

// LoginGuard provides in-process brute-force protection for login attempts.
// After maxFailures failures within a window, the identifier is locked for
// lockSeconds. Safe for concurrent use.
type LoginGuard struct {
	mu          sync.Mutex
	maxFailures int
	window      time.Duration
	lockTime    time.Duration
	entries     map[string]*loginEntry
}

// NewLoginGuard creates a LoginGuard with the given thresholds.
func NewLoginGuard(maxFailures int, window, lockTime time.Duration) *LoginGuard {
	return &LoginGuard{
		maxFailures: maxFailures,
		window:      window,
		lockTime:    lockTime,
		entries:     make(map[string]*loginEntry),
	}
}

// IsLocked reports whether the identifier is currently locked out.
func (g *LoginGuard) IsLocked(identifier string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	entry, ok := g.entries[identifier]
	if !ok {
		return false
	}
	// A never-locked entry has a zero lockedUntil; only clear once the lock
	// has actually been set and then elapsed.
	if !entry.lockedUntil.IsZero() && time.Now().After(entry.lockedUntil) {
		delete(g.entries, identifier)
		return false
	}
	return !entry.lockedUntil.IsZero()
}

// RecordFailure registers a failed login and returns whether the identifier
// is now locked out.
func (g *LoginGuard) RecordFailure(identifier string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	entry, ok := g.entries[identifier]
	if !ok {
		entry = &loginEntry{firstAt: now}
		g.entries[identifier] = entry
	} else if now.Sub(entry.firstAt) > g.window {
		// The failure window elapsed since the first failure: restart counting.
		entry.firstAt = now
		entry.failCount = 0
	}
	entry.failCount++
	if entry.failCount >= g.maxFailures {
		entry.lockedUntil = now.Add(g.lockTime)
		entry.firstAt = now
		entry.failCount = 0
		return true
	}
	return false
}

// Reset clears the failure counter on a successful login.
func (g *LoginGuard) Reset(identifier string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.entries, identifier)
}
