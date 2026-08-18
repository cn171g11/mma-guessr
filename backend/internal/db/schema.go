package db

import (
	"database/sql"
	"strings"
	"time"
)

// Migrate creates all tables if they do not yet exist. It is idempotent and
// safe to run on every startup.
func Migrate(conn *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			equipped_title TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS locations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			mapillary_id TEXT,
			lat REAL NOT NULL,
			lng REAL NOT NULL,
			country TEXT,
			city TEXT,
			region TEXT NOT NULL,
			difficulty INTEGER NOT NULL,
			panorama_url TEXT,
			source TEXT NOT NULL DEFAULT 'mapillary',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_locations_region_difficulty
			ON locations (region, difficulty)`,
		`CREATE INDEX IF NOT EXISTS idx_locations_source_region_difficulty
			ON locations (source, region, difficulty)`,

		`CREATE TABLE IF NOT EXISTS game_results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			player_type TEXT NOT NULL CHECK (player_type IN ('guest','user')),
			player_id TEXT NOT NULL,
			mode TEXT NOT NULL,
			region TEXT,
			total_score INTEGER NOT NULL,
			rounds TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_game_results_player_created
			ON game_results (player_type, player_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_game_results_player_mode_score
			ON game_results (player_type, player_id, mode, total_score DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_game_results_mode_created
			ON game_results (mode, created_at)`,

		`CREATE TABLE IF NOT EXISTS scores (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			player_type TEXT NOT NULL CHECK (player_type IN ('guest','user')),
			player_id TEXT NOT NULL,
			mode TEXT NOT NULL,
			score INTEGER NOT NULL CHECK (score >= 0),
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_scores_player_created
			ON scores (player_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_scores_mode_score
			ON scores (mode, score DESC)`,

		`CREATE TABLE IF NOT EXISTS leaderboard_best (
			mode TEXT NOT NULL,
			date_key TEXT NOT NULL,
			player_id TEXT NOT NULL,
			best_score INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (mode, date_key, player_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_leaderboard_best_rank
			ON leaderboard_best (mode, date_key, best_score DESC)`,

		`CREATE TABLE IF NOT EXISTS daily_challenges (
			date TEXT PRIMARY KEY,
			location_ids TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS daily_submissions (
			player_id TEXT NOT NULL,
			date TEXT NOT NULL,
			game_id INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (player_id, date)
		)`,

		`CREATE TABLE IF NOT EXISTS achievements (
			code TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT NOT NULL,
			icon TEXT NOT NULL,
			has_title INTEGER NOT NULL DEFAULT 0,
			title TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS user_achievements (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			achievement_code TEXT NOT NULL REFERENCES achievements(code) ON DELETE CASCADE,
			unlocked_at TEXT NOT NULL,
			PRIMARY KEY (user_id, achievement_code)
		)`,

		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			user_id TEXT PRIMARY KEY,
			token_hash TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS verification_codes (
			email TEXT PRIMARY KEY,
			code_hash TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			last_sent_at TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS guest_sessions (
			guest_id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS guest_progress (
			guest_id TEXT PRIMARY KEY REFERENCES guest_sessions(guest_id) ON DELETE CASCADE,
			total_rounds INTEGER NOT NULL DEFAULT 0,
			total_score INTEGER NOT NULL DEFAULT 0,
			best_score INTEGER NOT NULL DEFAULT 0,
			correct_guesses INTEGER NOT NULL DEFAULT 0
		)`,

		`CREATE TABLE IF NOT EXISTS user_progress (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			total_rounds INTEGER NOT NULL DEFAULT 0,
			total_score INTEGER NOT NULL DEFAULT 0,
			best_score INTEGER NOT NULL DEFAULT 0,
			correct_guesses INTEGER NOT NULL DEFAULT 0
		)`,

		`CREATE TABLE IF NOT EXISTS mapillary_cache (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS nonces (
			nonce TEXT PRIMARY KEY,
			expires_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS friends (
			requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (requester_id, addressee_id),
			CHECK (requester_id != addressee_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_friends_addressee
			ON friends (addressee_id, status)`,

		`CREATE TABLE IF NOT EXISTS season_ratings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			season TEXT NOT NULL,
			rating INTEGER NOT NULL DEFAULT 1000,
			tier INTEGER NOT NULL DEFAULT 1,
			games_played INTEGER NOT NULL DEFAULT 0,
			wins INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_season_ratings_rating
			ON season_ratings (season, rating DESC)`,

		`CREATE TABLE IF NOT EXISTS user_streaks (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			current_streak INTEGER NOT NULL DEFAULT 0,
			best_streak INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS location_facts (
			location_id INTEGER PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
			fact TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS sponsors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			note TEXT,
			amount_cents INTEGER NOT NULL DEFAULT 0,
			visible INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL
		)`,

		`CREATE TABLE IF NOT EXISTS oauth_accounts (
			provider TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TEXT NOT NULL,
			PRIMARY KEY (provider, provider_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user
			ON oauth_accounts (user_id)`,

		`CREATE TABLE IF NOT EXISTS packs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			is_public INTEGER NOT NULL DEFAULT 0,
			play_count INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_packs_owner ON packs (owner_id)`,
		`CREATE INDEX IF NOT EXISTS idx_packs_public_play
			ON packs (is_public, play_count DESC)`,

		`CREATE TABLE IF NOT EXISTS pack_locations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			lat REAL NOT NULL,
			lng REAL NOT NULL,
			difficulty INTEGER NOT NULL DEFAULT 3,
			region TEXT NOT NULL DEFAULT 'world',
			image_id TEXT,
			panorama_url TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pack_locations_pack
			ON pack_locations (pack_id)`,
	}

	for _, stmt := range statements {
		if _, err := conn.Exec(stmt); err != nil {
			return err
		}
	}

	if err := migrateGameResultsRounds(conn); err != nil {
		return err
	}
	if err := migrateGameResultsPackID(conn); err != nil {
		return err
	}
	if err := backfillLeaderboardBest(conn); err != nil {
		return err
	}

	return seedAchievements(conn)
}

// backfillLeaderboardBest seeds the leaderboard_best table from the scores
// history the first time it runs (existing databases upgraded in place). Live
// game submissions keep the table current afterwards, so the full scan runs
// exactly once; INSERT OR IGNORE preserves any higher already-recorded bests.
func backfillLeaderboardBest(conn *sql.DB) error {
	var count int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM leaderboard_best`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if _, err := conn.Exec(
		`INSERT OR IGNORE INTO leaderboard_best (mode, date_key, player_id, best_score, updated_at)
		 SELECT mode, '', player_id, MAX(score), MAX(created_at) FROM scores
		 WHERE player_type = 'user' GROUP BY mode, player_id`); err != nil {
		return err
	}
	boundary := time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")
	_, err := conn.Exec(
		`INSERT OR IGNORE INTO leaderboard_best (mode, date_key, player_id, best_score, updated_at)
		 SELECT mode, substr(created_at, 1, 10), player_id, MAX(score), MAX(created_at) FROM scores
		 WHERE player_type = 'user' AND substr(created_at, 1, 10) >= ?
		 GROUP BY mode, substr(created_at, 1, 10), player_id`, boundary)
	return err
}

// migrateGameResultsRounds adds the rounds JSON column to databases created
// before it existed. SQLite ALTER TABLE cannot add a column with a
// non-constant default, so the plain default applies.
func migrateGameResultsRounds(conn *sql.DB) error {
	rows, err := conn.Query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'game_results'`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var createSQL string
		if err := rows.Scan(&createSQL); err != nil {
			_ = rows.Close() // #nosec G104 -- the pool is single-connection; release before returning
			return err
		}
		if !strings.Contains(createSQL, "rounds") {
			// Close the cursor before issuing DDL: the pool is limited to a
			// single connection, so executing ALTER while the query is still
			// open deadlocks (all goroutines asleep waiting on the conn).
			if err := rows.Close(); err != nil {
				return err
			}
			_, err = conn.Exec(`ALTER TABLE game_results ADD COLUMN rounds TEXT NOT NULL DEFAULT '[]'`)
			return err
		}
	}
	return rows.Err()
}

// migrateGameResultsPackID adds the pack_id column to databases created
// before pack games existed. The column stays null for regular games, which
// lets the aggregate queries exclude casual pack play by pack_id IS NULL.
func migrateGameResultsPackID(conn *sql.DB) error {
	rows, err := conn.Query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'game_results'`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var createSQL string
		if err := rows.Scan(&createSQL); err != nil {
			_ = rows.Close() // #nosec G104 -- the pool is single-connection; release before returning
			return err
		}
		if !strings.Contains(createSQL, "pack_id") {
			if err := rows.Close(); err != nil {
				return err
			}
			_, err = conn.Exec(`ALTER TABLE game_results ADD COLUMN pack_id INTEGER`)
			return err
		}
	}
	return rows.Err()
}

func seedAchievements(conn *sql.DB) error {
	const insert = `INSERT OR IGNORE INTO achievements (code, name, description, icon, has_title, title) VALUES
		('first_game',    '首次游玩', '完成第一局游戏', '🎮', 0, NULL),
		('games_10',      '渐入佳境', '累计完成 10 局游戏', '🕹️', 0, NULL),
		('games_100',     '百局老兵', '累计完成 100 局游戏', '🎖️', 1, '百局老兵'),
		('rounds_100',    '百轮历练', '累计完成 100 轮挑战', '🔟', 0, NULL),
		('score_100k',    '十万大神', '累计总分达到 100,000 分', '💎', 1, '十万大神'),
		('perfect_round', '一击必中', '单轮获得满分 5000 分', '🎯', 0, NULL),
		('perfect_game',  '登峰造极', '完成一局且每轮均获满分', '🏆', 0, NULL),
		('mode_master',   '全能选手', '体验全部 7 种单人游戏模式', '🌍', 1, '全能选手'),
		('daily_regular', '每日坚持', '累计完成 7 天每日挑战', '📅', 0, NULL),
		('daily_30',      '每日之星', '累计完成 30 天每日挑战', '🌟', 1, '每日之星'),
		('accuracy_90',   '神射手', '总命中率高于 90%', '🎖️', 1, '神射手'),
		('best_20k',      '高分达人', '单局成绩达到 20,000 分', '🚀', 1, '高分达人'),
		('china_10',      '中国通', '累计完成 10 局中国模式', '🐉', 1, '中国通'),
		('landmark_10',   '地标巡礼', '累计完成 10 局地标模式', '🗼', 0, NULL),
		('streak_3',      '三连胜', '对战模式连胜 3 场', '🔥', 0, NULL),
		('streak_10',     '十连胜', '对战模式连胜 10 场', '⚡', 1, '十连胜'),
		('consecutive_5', '连环射手', '单局内连续答对 5 轮', '🎯', 0, NULL),
		('regions_4',     '环球旅行家', '累计体验 4 个不同区域', '🗺️', 1, '环球旅行家'),
		('daily_full',    '每日满分', '单次每日挑战每轮均获满分', '🏅', 0, NULL)`
	_, err := conn.Exec(insert)
	return err
}
