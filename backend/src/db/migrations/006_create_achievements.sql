-- 成就与称号系统：
-- · achievements：成就静态定义（含是否可作为称号装备）
-- · user_achievements：玩家解锁记录（user_id 级联删除）
-- · users.equipped_title：当前装备的称号（显示用，值为成就 title 文本）
CREATE TABLE IF NOT EXISTS achievements (
    code VARCHAR(40) PRIMARY KEY,
    name VARCHAR(40) NOT NULL,
    description VARCHAR(200) NOT NULL,
    icon VARCHAR(10) NOT NULL,
    has_title BOOLEAN NOT NULL DEFAULT false,
    title VARCHAR(40)
);

INSERT INTO achievements (code, name, description, icon, has_title, title) VALUES
    ('first_game',     '首次游玩', '完成第一局游戏', '🎮', false, NULL),
    ('games_10',       '渐入佳境', '累计完成 10 局游戏', '🕹️', false, NULL),
    ('games_100',      '百局老兵', '累计完成 100 局游戏', '🎖️', true, '百局老兵'),
    ('rounds_100',     '百轮历练', '累计完成 100 轮挑战', '🔟', false, NULL),
    ('score_100k',     '十万大神', '累计总分达到 100,000 分', '💎', true, '十万大神'),
    ('perfect_round',  '一击必中', '单轮获得满分 5000 分', '🎯', false, NULL),
    ('perfect_game',   '登峰造极', '完成一局且每轮均获满分', '🏆', false, NULL),
    ('mode_master',    '全能选手', '体验全部 7 种单人游戏模式', '🌍', true, '全能选手'),
    ('daily_regular',  '每日坚持', '累计完成 7 天每日挑战', '📅', false, NULL),
    ('daily_30',       '每日之星', '累计完成 30 天每日挑战', '🌟', true, '每日之星'),
    ('accuracy_90',    '神射手', '总命中率高于 90%', '🎖️', true, '神射手'),
    ('best_20k',       '高分达人', '单局成绩达到 20,000 分', '🚀', true, '高分达人'),
    ('china_10',       '中国通', '累计完成 10 局中国模式', '🐉', true, '中国通'),
    ('landmark_10',    '地标巡礼', '累计完成 10 局地标模式', '🗼', false, NULL)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_code VARCHAR(40) NOT NULL REFERENCES achievements(code) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_code)
);

CREATE INDEX IF NOT EXISTS user_achievements_code_idx ON user_achievements (achievement_code);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS equipped_title VARCHAR(40);