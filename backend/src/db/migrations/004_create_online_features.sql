-- 排行榜得分记录：仅注册用户上榜（游客可查看榜单），user_id 对应用户表主键
-- game_results 保存全量对局明细，scores 为榜单专用投影，供每日校准任务重建 Redis ZSET
CREATE TABLE IF NOT EXISTS scores (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    mode VARCHAR(20) NOT NULL,
    score INT NOT NULL CHECK (score >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scores_user_created_idx ON scores (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scores_mode_created_idx ON scores (mode, created_at DESC);

-- 每日挑战：以 UTC 日期为主键，location_ids 为该日固定的 10 道题目
CREATE TABLE IF NOT EXISTS daily_challenges (
    date DATE PRIMARY KEY,
    location_ids BIGINT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
