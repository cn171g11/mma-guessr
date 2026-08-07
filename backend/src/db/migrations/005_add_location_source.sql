-- 数据源扩展：为每道题目标记图片来源（当前 mapillary，未来可持续接入其他图源）。
-- 默认值保证存量数据无需回填即归类到 mapillary；新建题目由 seed 脚本显式写入来源。
ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'mapillary';

-- 组池查询按 (source, region, difficulty) 过滤，建复合索引支撑
CREATE INDEX IF NOT EXISTS locations_source_region_difficulty_idx ON locations (source, region, difficulty);