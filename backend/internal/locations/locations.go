package locations

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"math/big"
	"strconv"

	"mma-guessr/backend/internal/kv"
)

// LocationRegions are the six supported regions.
var LocationRegions = []string{"asia", "europe", "northamerica", "southamerica", "africa", "oceania"}

// LocationSources are the supported imagery sources.
var LocationSources = []string{"mapillary"}

// LocationRecord is a full question-bank record.
type LocationRecord struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	MapillaryID *string `json:"mapillaryId"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	Country     *string `json:"country"`
	City        *string `json:"city"`
	Region      string  `json:"region"`
	Difficulty  int     `json:"difficulty"`
	PanoramaURL *string `json:"panoramaUrl"`
	Source      string  `json:"source"`
}

// LocationStats summarizes the question bank.
type LocationStats struct {
	Total    int            `json:"total"`
	ByRegion map[string]int `json:"byRegion"`
}

// RandomLocationsQuery filters the random draw.
type RandomLocationsQuery struct {
	Region     *string
	Difficulty *int
	Source     *string
	Count      int
}

// Store provides data access for locations.
type Store struct {
	conn *sql.DB
	kv   *kv.Store
}

// NewStore creates a locations Store with the given cache.
func NewStore(conn *sql.DB, cache *kv.Store) *Store {
	return &Store{conn: conn, kv: cache}
}

// fetchPoolIDs returns the IDs matching the filters.
func (s *Store) fetchPoolIDs(region *string, difficulty *int, source *string) ([]int64, error) {
	query := `SELECT id FROM locations`
	conditions := []string{}
	args := []any{}
	if region != nil {
		conditions = append(conditions, "region = ?")
		args = append(args, *region)
	}
	if difficulty != nil {
		conditions = append(conditions, "difficulty = ?")
		args = append(args, *difficulty)
	}
	if source != nil {
		conditions = append(conditions, "source = ?")
		args = append(args, *source)
	}
	if len(conditions) > 0 {
		query += " WHERE " + joinAnd(conditions) // #nosec G202 -- conditions are fixed constants, values are parameterized
	}
	rows, err := s.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// FetchByIDs returns full records for the given IDs (order unspecified).
func (s *Store) FetchByIDs(ids []int64) ([]LocationRecord, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders := ""
	args := make([]any, 0, len(ids))
	for i, id := range ids {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, id)
	}
	rows, err := s.conn.Query(
		`SELECT id, name, mapillary_id, lat, lng, country, city, region, difficulty, panorama_url, source
		 FROM locations WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []LocationRecord
	for rows.Next() {
		var record LocationRecord
		var mapillaryID, country, city, panoramaURL sql.NullString
		if err := rows.Scan(&record.ID, &record.Name, &mapillaryID, &record.Lat, &record.Lng,
			&country, &city, &record.Region, &record.Difficulty, &panoramaURL, &record.Source); err != nil {
			return nil, err
		}
		if mapillaryID.Valid {
			record.MapillaryID = &mapillaryID.String
		}
		if country.Valid {
			record.Country = &country.String
		}
		if city.Valid {
			record.City = &city.String
		}
		if panoramaURL.Valid {
			record.PanoramaURL = &panoramaURL.String
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

// GetRandomLocations draws count random locations from the pool, rebuilding
// the pool cache when it is missing or too small.
func (s *Store) GetRandomLocations(query RandomLocationsQuery) ([]LocationRecord, error) {
	region, difficulty, source := poolAll, poolAll, poolAll
	if query.Region != nil {
		region = *query.Region
	}
	if query.Difficulty != nil {
		difficulty = strconv.Itoa(*query.Difficulty)
	}
	if query.Source != nil {
		source = *query.Source
	}
	key := poolKey(source, region, difficulty)

	if err := s.ensurePool(key, query.Region, query.Difficulty, query.Source); err != nil {
		return nil, err
	}

	ids := s.randomFromPool(key, query.Count)
	// A short pool usually means stale cache after a reseed: rebuild once.
	if len(ids) > 0 && len(ids) < query.Count {
		_ = s.kv.Del(key)
		if err := s.ensurePool(key, query.Region, query.Difficulty, query.Source); err != nil {
			return nil, err
		}
		ids = s.randomFromPool(key, query.Count)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	return s.FetchByIDs(ids)
}

const (
	poolAll      = "all"
	poolTTL      = 60 * 60
	poolEmptyTTL = 60
)

func poolKey(source, region, difficulty string) string {
	return "locations:pool:" + source + ":" + region + ":" + difficulty
}

// ensurePool rebuilds the ID pool from the database when the cache is cold.
func (s *Store) ensurePool(key string, region *string, difficulty *int, source *string) error {
	if _, ok := s.kv.Get(key); ok {
		return nil
	}
	ids, err := s.fetchPoolIDs(region, difficulty, source)
	if err != nil {
		return err
	}
	ttl := poolTTL
	if len(ids) == 0 {
		ttl = poolEmptyTTL
	}
	raw, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return s.kv.Set(key, string(raw), ttl)
}

// randomFromPool draws count IDs without replacement (shuffle-sampling).
func (s *Store) randomFromPool(key string, count int) []int64 {
	raw, ok := s.kv.Get(key)
	if !ok {
		return nil
	}
	var ids []int64
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil
	}
	if count >= len(ids) {
		return ids
	}
	shuffleIDs(ids)
	return ids[:count]
}

// shuffleIDs randomizes ids in place using a cryptographic source so draws
// are never predictable from a seeded PRNG.
func shuffleIDs(ids []int64) {
	for i := len(ids) - 1; i > 0; i-- {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return
		}
		j := n.Int64()
		ids[i], ids[j] = ids[j], ids[i]
	}
}

// GetLocationStats returns cached per-region counts.
func (s *Store) GetLocationStats() (*LocationStats, error) {
	const statsKey = "locations:stats"
	if cached, ok := s.kv.Get(statsKey); ok {
		var stats LocationStats
		if err := json.Unmarshal([]byte(cached), &stats); err == nil {
			return &stats, nil
		}
	}

	rows, err := s.conn.Query(`SELECT region, COUNT(*) FROM locations GROUP BY region`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byRegion := map[string]int{}
	total := 0
	for rows.Next() {
		var region string
		var count int
		if err := rows.Scan(&region, &count); err != nil {
			return nil, err
		}
		byRegion[region] = count
		total += count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	stats := &LocationStats{Total: total, ByRegion: byRegion}
	if raw, err := json.Marshal(stats); err == nil {
		_ = s.kv.Set(statsKey, string(raw), 5*60)
	}
	return stats, nil
}

// GetLocationsByIDs fetches records in the order of the given IDs (the daily
// challenge order must be stable).
func (s *Store) GetLocationsByIDs(ids []int64) ([]LocationRecord, error) {
	records, err := s.FetchByIDs(ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]LocationRecord, len(records))
	for _, record := range records {
		byID[record.ID] = record
	}
	ordered := make([]LocationRecord, 0, len(ids))
	for _, id := range ids {
		if record, ok := byID[id]; ok {
			ordered = append(ordered, record)
		}
	}
	return ordered, nil
}

func joinAnd(conditions []string) string {
	out := conditions[0]
	for _, c := range conditions[1:] {
		out += " AND " + c
	}
	return out
}
