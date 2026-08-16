package ratelimit

import (
	"sync"
	"time"
)

// SlidingWindow is an in-process sliding-window rate limiter. It keeps a
// per-key deque of timestamps and rejects once the count within the window
// exceeds the limit. Safe for concurrent use.
type SlidingWindow struct {
	mu      sync.Mutex
	window  time.Duration
	limit   int
	buckets map[string][]int64
}

// NewSlidingWindow creates a limiter allowing `limit` events per `window`.
func NewSlidingWindow(window time.Duration, limit int) *SlidingWindow {
	return &SlidingWindow{
		window:  window,
		limit:   limit,
		buckets: make(map[string][]int64),
	}
}

// Allow reports whether a new event for key is within the limit. It records
// the event when allowed.
func (s *SlidingWindow) Allow(key string) bool {
	now := time.Now().UnixMilli()
	cutoff := now - s.window.Milliseconds()

	s.mu.Lock()
	defer s.mu.Unlock()

	events := s.buckets[key]
	// Drop stale entries to keep the deque bounded.
	kept := events[:0]
	for _, ts := range events {
		if ts > cutoff {
			kept = append(kept, ts)
		}
	}
	if len(kept) >= s.limit {
		s.buckets[key] = kept
		return false
	}
	kept = append(kept, now)
	s.buckets[key] = kept
	return true
}

// Reset clears all recorded events for key (used on login success to clear a
// brute-force counter).
func (s *SlidingWindow) Reset(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.buckets, key)
}

// Count returns the number of events for key within the current window.
func (s *SlidingWindow) Count(key string) int {
	now := time.Now().UnixMilli()
	cutoff := now - s.window.Milliseconds()

	s.mu.Lock()
	defer s.mu.Unlock()

	count := 0
	for _, ts := range s.buckets[key] {
		if ts > cutoff {
			count++
		}
	}
	return count
}
