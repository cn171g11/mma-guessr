package ratings

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	_, err = conn.Exec(`
		CREATE TABLE user_streaks (
			user_id TEXT PRIMARY KEY,
			current_streak INTEGER NOT NULL,
			best_streak INTEGER NOT NULL,
			updated_at TEXT NOT NULL
		);
	`)
	if err != nil {
		t.Fatalf("create user_streaks: %v", err)
	}
	return conn
}

func TestRecordDuelStreak(t *testing.T) {
	svc := NewService(openTestDB(t))
	const user = "u1"

	cases := []struct {
		won  bool
		cur  int
		best int
	}{
		{true, 1, 1},
		{true, 2, 2},
		{false, 0, 2},
		{true, 1, 2},
		{true, 2, 2},
		{true, 3, 3},
	}
	for _, tc := range cases {
		if err := svc.RecordDuel(user, tc.won); err != nil {
			t.Fatalf("RecordDuel(won=%v): %v", tc.won, err)
		}
		var cur, best int
		err := svc.conn.QueryRow(`SELECT current_streak, best_streak FROM user_streaks WHERE user_id = ?`, user).
			Scan(&cur, &best)
		if err != nil {
			t.Fatalf("read streak: %v", err)
		}
		if cur != tc.cur || best != tc.best {
			t.Fatalf("after RecordDuel(won=%v): got (cur=%d, best=%d), want (%d, %d)",
				tc.won, cur, best, tc.cur, tc.best)
		}
	}
}

func TestRatingDelta(t *testing.T) {
	tests := []struct {
		name  string
		score int
		want  int
	}{
		{"perfect game gains full", 50000, 25},
		{"half game gains zero then floor one", 25000, 1},
		{"zero score loses", 0, -25},
		{"negative clamps to zero", -5, -25},
		{"above max clamps", 999999, 25},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := RatingDelta(tc.score); got != tc.want {
				t.Fatalf("RatingDelta(%d) = %d, want %d", tc.score, got, tc.want)
			}
		})
	}
}

func TestTierFor(t *testing.T) {
	tests := []struct {
		rating int
		tier   int
		name   string
	}{
		{0, 1, "青铜"},
		{1000, 1, "青铜"},
		{1100, 2, "白银"},
		{1299, 2, "白银"},
		{1300, 3, "黄金"},
		{1500, 4, "铂金"},
		{1800, 5, "钻石"},
		{2100, 6, "大师"},
		{2500, 7, "宗师"},
		{3000, 7, "宗师"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tier, name := TierFor(tc.rating)
			if tier != tc.tier || name != tc.name {
				t.Fatalf("TierFor(%d) = (%d,%s), want (%d,%s)", tc.rating, tier, name, tc.tier, tc.name)
			}
		})
	}
}

func TestNextTierName(t *testing.T) {
	if got := NextTierName(1000); got == nil || *got != "白银" {
		t.Fatalf("expected 白银, got %v", got)
	}
	if got := NextTierName(3000); got != nil {
		t.Fatalf("expected nil at the top, got %v", got)
	}
}