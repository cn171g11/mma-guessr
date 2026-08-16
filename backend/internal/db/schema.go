package db

import (
	"database/sql"
	"strings"
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
	}

	for _, stmt := range statements {
		if _, err := conn.Exec(stmt); err != nil {
			return err
		}
	}

	if err := migrateGameResultsRounds(conn); err != nil {
		return err
	}

	return seedAchievements(conn)
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
			rows.Close()
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
		('landmark_10',   '地标巡礼', '累计完成 10 局地标模式', '🗼', 0, NULL)`
	_, err := conn.Exec(insert)
	return err
}
