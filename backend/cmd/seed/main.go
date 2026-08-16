package main

import (
	"database/sql"
	"flag"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mma-guessr/backend/internal/config"
	"mma-guessr/backend/internal/db"
)

var validRegions = map[string]bool{
	"asia": true, "europe": true, "northamerica": true,
	"southamerica": true, "africa": true, "oceania": true,
}

var (
	fieldNameRe = regexp.MustCompile(`name:\s*'([^']*)'`)
	fieldLatRe  = regexp.MustCompile(`lat:\s*([-\d.]+)`)
	fieldLngRe  = regexp.MustCompile(`lng:\s*([-\d.]+)`)
	fieldRegRe  = regexp.MustCompile(`region:\s*'([^']*)'`)
	fieldDiffRe = regexp.MustCompile(`difficulty:\s*(\d+)`)
)

func main() {
	dataFile := flag.String("data", "", "path to frontend/src/js/data.js")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	if *dataFile == "" {
		// Resolve relative to the repository root (two levels above backend).
		wd, _ := os.Getwd()
		*dataFile = filepath.Join(wd, "..", "frontend", "src", "js", "data.js")
	}

	src, err := os.ReadFile(*dataFile)
	if err != nil {
		log.Fatalf("read data file: %v", err)
	}

	entries := parseLocations(string(src))
	log.Printf("parsed %d location entries from %s", len(entries), *dataFile)

	conn, err := db.Open(cfg.SQLitePath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	if err := db.Migrate(conn); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	seeded, skipped, err := upsertLocations(conn, entries)
	if err != nil {
		log.Fatalf("seed locations: %v", err)
	}
	log.Printf("seeded %d locations, skipped %d invalid", seeded, skipped)
}

type location struct {
	name       string
	lat, lng   float64
	region     string
	difficulty int
}

func parseLocations(src string) []location {
	marker := "const LOCATIONS ="
	start := strings.Index(src, marker)
	if start < 0 {
		return nil
	}

	// Skip to the opening '[' of the array literal.
	openIndex := strings.IndexByte(src[start+len(marker):], '[')
	if openIndex < 0 {
		return nil
	}
	openIndex += start + len(marker)

	// Bracket-pair scan with string-literal awareness, mirroring the original
	// Node parser which only evaluates the array literal and never executes code.
	endIndex := -1
	depth := 0
	inString := false
	var quote byte
	for i := openIndex; i < len(src); i++ {
		ch := src[i]
		if inString {
			if ch == '\\' {
				i++
				continue
			}
			if ch == quote {
				inString = false
			}
			continue
		}
		switch ch {
		case '\'', '"', '`':
			inString = true
			quote = ch
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				endIndex = i
			}
		}
		if endIndex >= 0 {
			break
		}
	}
	if endIndex < 0 {
		return nil
	}

	body := src[openIndex+1 : endIndex]
	var result []location
	for _, chunk := range splitObjects(body) {
		name := fieldNameRe.FindStringSubmatch(chunk)
		lat := fieldLatRe.FindStringSubmatch(chunk)
		lng := fieldLngRe.FindStringSubmatch(chunk)
		region := fieldRegRe.FindStringSubmatch(chunk)
		difficulty := fieldDiffRe.FindStringSubmatch(chunk)
		if len(name) < 2 || len(lat) < 2 || len(lng) < 2 || len(region) < 2 || len(difficulty) < 2 {
			continue
		}
		latV, err1 := strconv.ParseFloat(lat[1], 64)
		lngV, err2 := strconv.ParseFloat(lng[1], 64)
		diffV, err3 := strconv.Atoi(difficulty[1])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		if !validRegions[region[1]] {
			continue
		}
		result = append(result, location{
			name:       name[1],
			lat:        latV,
			lng:        lngV,
			region:     region[1],
			difficulty: diffV,
		})
	}
	return result
}

// splitObjects splits the LOCATIONS array body into individual object chunks,
// respecting nested braces so that multi-line entries are kept whole.
func splitObjects(body string) []string {
	var chunks []string
	depth := 0
	start := -1
	inString := false
	var quote byte
	for i := 0; i < len(body); i++ {
		ch := body[i]
		if inString {
			if ch == '\\' {
				i++
				continue
			}
			if ch == quote {
				inString = false
			}
			continue
		}
		switch ch {
		case '\'', '"', '`':
			inString = true
			quote = ch
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			depth--
			if depth == 0 && start >= 0 {
				chunks = append(chunks, body[start:i+1])
				start = -1
			}
		}
	}
	return chunks
}

func upsertLocations(conn *sql.DB, entries []location) (int, int, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	stmt, err := conn.Prepare(`INSERT INTO locations
		(name, lat, lng, region, difficulty, source, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'mapillary', ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			lat = excluded.lat,
			lng = excluded.lng,
			region = excluded.region,
			difficulty = excluded.difficulty,
			updated_at = excluded.updated_at`)
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()

	seeded, skipped := 0, 0
	for _, entry := range entries {
		res, err := stmt.Exec(entry.name, entry.lat, entry.lng, entry.region, entry.difficulty, now, now)
		if err != nil {
			log.Printf("skip %q: %v", entry.name, err)
			skipped++
			continue
		}
		if n, _ := res.RowsAffected(); n > 0 {
			seeded++
		}
	}
	return seeded, skipped, nil
}
