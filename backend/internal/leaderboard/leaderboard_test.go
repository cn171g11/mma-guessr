package leaderboard

import (
	"testing"
	"time"
)

func TestNextMidnightUTCAdvancesToNextDayBoundary(t *testing.T) {
	now := time.Date(2026, 8, 17, 12, 34, 56, 0, time.UTC)
	want := time.Date(2026, 8, 18, 0, 0, 0, 0, time.UTC)

	if got := nextMidnightUTC(now); !got.Equal(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestNextMidnightUTCAdvancesWhenExactlyAtMidnight(t *testing.T) {
	now := time.Date(2026, 8, 17, 0, 0, 0, 0, time.UTC)
	want := time.Date(2026, 8, 18, 0, 0, 0, 0, time.UTC)

	if got := nextMidnightUTC(now); !got.Equal(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestNextMidnightUTCIgnoresLocalOffset(t *testing.T) {
	// 23:00 +02:00 is 21:00Z on the 17th; the boundary is still 18th 00:00Z.
	now := time.Date(2026, 8, 17, 23, 0, 0, 0, time.FixedZone("+02", 2*60*60))
	want := time.Date(2026, 8, 18, 0, 0, 0, 0, time.UTC)

	if got := nextMidnightUTC(now); !got.Equal(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}