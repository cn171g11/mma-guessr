-- 游戏结果表：每局结算明细，游客与注册用户共用
-- 不建外键：游客记录随会话 TTL 过期清理，注册用户删除时无需级联
CREATE TABLE IF NOT EXISTS game_results (
    id BIGSERIAL PRIMARY KEY,
    player_type VARCHAR(5) NOT NULL CHECK (player_type IN ('guest', 'user')),
    player_id VARCHAR(64) NOT NULL,
    mode VARCHAR(20) NOT NULL,
    region VARCHAR(20),
    total_score INT NOT NULL,
    rounds JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 历史记录按玩家倒序；最佳成绩按玩家 + 模式取最高分
CREATE INDEX IF NOT EXISTS game_results_player_created_idx ON game_results (player_type, player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS game_results_player_mode_score_idx ON game_results (player_type, player_id, mode, total_score DESC);
