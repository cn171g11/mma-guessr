package facts

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"mma-guessr/backend/internal/httputil"
)

// regionNames maps the internal region keys to display labels used in the
// templated fallback fact.
var regionNames = map[string]string{
	"asia":         "亚洲",
	"europe":       "欧洲",
	"northamerica": "北美洲",
	"southamerica": "南美洲",
	"africa":       "非洲",
	"oceania":      "大洋洲",
}

// curated facts for well-known locations, keyed by the exact location name.
// INSERT OR IGNORE during Seed keeps them idempotent.
var curated = map[string]string{
	"长城":        "长城全长超过 21,000 公里，是世界上修建时间最长、工程量最大的防御工程。",
	"埃菲尔铁塔":    "埃菲尔铁塔于 1889 年落成，高 330 米，曾保持世界最高建筑纪录 41 年。",
	"自由女神像":    "自由女神像是法国赠予美国的礼物，于 1886 年揭幕，全高 93 米。",
	"金字塔":       "吉萨大金字塔约建于公元前 2560 年，由约 230 万块巨石砌成。",
	"悉尼歌剧院":    "悉尼歌剧院的设计灵感源自切开的橙子，1973 年正式开放。",
	"富士山":       "富士山海拔 3,776 米，是日本最高峰，也是一座仍在监测中的活火山。",
	"大本钟":       "大本钟其实是钟楼中那口钟的名字，钟楼官方名称为伊丽莎白塔。",
	"泰姬陵":       "泰姬陵是莫卧儿皇帝为爱妃修建的陵墓，耗时约 22 年、动用 2 万余名工匠。",
	"凯旋门":       "巴黎凯旋门高 50 米，为纪念拿破仑的军事胜利而建，下方是无名烈士墓。",
	"兵马俑":       "兵马俑于 1974 年被当地农民打井时发现，已出土陶俑超过 8,000 件。",
}

// Service resolves location facts with a curated database and a templated
// fallback so every location has a non-empty answer.
type Service struct {
	conn *sql.DB
}

// NewService creates a facts Service.
func NewService(conn *sql.DB) *Service {
	return &Service{conn: conn}
}

// Seed inserts curated facts for locations that exist. Safe to run at startup.
func (s *Service) Seed() error {
	for name, fact := range curated {
		if _, err := s.conn.Exec(`
			INSERT OR IGNORE INTO location_facts (location_id, fact)
			SELECT id, ? FROM locations WHERE name = ?
		`, fact, name); err != nil {
			return err
		}
	}
	return nil
}

// GetFact returns the fact for a location name, using a curated entry when
// present and a generated description otherwise.
func (s *Service) GetFact(name string) (string, error) {
	name = trimSpace(name)
	if name == "" {
		return "", httputil.BadRequest("地点名称不能为空")
	}
	var (
		fact   sql.NullString
		region string
	)
	err := s.conn.QueryRow(`
		SELECT lf.fact, l.region
		FROM locations l
		LEFT JOIN location_facts lf ON lf.location_id = l.id
		WHERE l.name = ?
	`, name).Scan(&fact, &region)
	if errors.Is(err, sql.ErrNoRows) {
		return "", httputil.NotFound("未找到该地点")
	}
	if err != nil {
		return "", err
	}
	if fact.Valid && fact.String != "" {
		return fact.String, nil
	}
	display := regionNames[region]
	if display == "" {
		display = "未知"
	}
	return fmt.Sprintf("「%s」位于%s区域。", name, display), nil
}

func trimSpace(v string) string {
	return strings.TrimSpace(v)
}