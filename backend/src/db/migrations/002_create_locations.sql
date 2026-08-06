-- 题库主表：街景点位
-- 数据源为 frontend/src/js/data.js 的 LOCATIONS（1570 条），导入脚本见 scripts/seed-locations.mjs
CREATE TABLE IF NOT EXISTS locations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    mapillary_id TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    country VARCHAR(120),
    city VARCHAR(120),
    region VARCHAR(20) NOT NULL,
    difficulty SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
    panorama_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT locations_lat_range CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT locations_lng_range CHECK (lng BETWEEN -180 AND 180)
);

CREATE UNIQUE INDEX IF NOT EXISTS locations_name_key ON locations (name);
CREATE INDEX IF NOT EXISTS locations_region_difficulty_idx ON locations (region, difficulty);

-- PostGIS 可选增强：检测到 postgis 扩展时才补充 geography(POINT) 列与 GIST 索引，
-- 用于未来“附近位置”查询（ST_DWithin 等）。未安装 PostGIS 时不影响基础功能。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'locations' AND column_name = 'location'
       ) THEN
        ALTER TABLE locations
            ADD COLUMN location geography(POINT, 4326)
            GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
        CREATE INDEX IF NOT EXISTS locations_location_gist ON locations USING gist (location);
    END IF;
END $$;