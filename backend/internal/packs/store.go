package packs

import (
	"database/sql"
	"errors"

	"mma-guessr/backend/internal/util"
)

// errNotFound marks a missing pack or a write that does not own the pack.
var errNotFound = errors.New("pack not found")

// Store provides data access for packs and their locations.
type Store struct {
	conn *sql.DB
}

// NewStore creates a packs Store.
func NewStore(conn *sql.DB) *Store {
	return &Store{conn: conn}
}

// CreatePack inserts a pack owned by the given user and returns it.
func (s *Store) CreatePack(ownerID, name, description string, isPublic bool) (*Pack, error) {
	now := util.Now()
	result, err := s.conn.Exec(
		`INSERT INTO packs (owner_id, name, description, is_public, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		ownerID, name, description, boolInt(isPublic), now, now)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &Pack{
		ID: id, OwnerID: ownerID, Name: name, Description: description,
		IsPublic: isPublic, CreatedAt: now, UpdatedAt: now,
	}, nil
}

// GetPack returns one pack with its owner username and location count.
func (s *Store) GetPack(id int64) (*Pack, error) {
	row := s.conn.QueryRow(
		`SELECT p.id, p.owner_id, u.username, p.name, p.description, p.is_public,
		        p.play_count, (SELECT COUNT(*) FROM pack_locations pl WHERE pl.pack_id = p.id),
		        p.created_at, p.updated_at
		 FROM packs p JOIN users u ON u.id = p.owner_id
		 WHERE p.id = ?`, id)
	var pack Pack
	var isPublic int
	err := row.Scan(&pack.ID, &pack.OwnerID, &pack.OwnerUsername, &pack.Name,
		&pack.Description, &isPublic, &pack.PlayCount, &pack.LocationCount,
		&pack.CreatedAt, &pack.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	pack.IsPublic = isPublic != 0
	return &pack, nil
}

// ListPacks lists packs matching the query, newest first.
func (s *Store) ListPacks(query ListQuery) ([]Pack, error) {
	conditions := []string{"1 = 1"}
	args := []any{}
	if query.OwnerID != "" {
		conditions = append(conditions, "p.owner_id = ?")
		args = append(args, query.OwnerID)
	} else {
		conditions = append(conditions, "p.is_public = 1")
	}
	if query.Search != "" {
		conditions = append(conditions, "instr(lower(p.name), lower(?)) > 0")
		args = append(args, query.Search)
	}
	queryText := `SELECT p.id, p.owner_id, u.username, p.name, p.description, p.is_public,
		        p.play_count, (SELECT COUNT(*) FROM pack_locations pl WHERE pl.pack_id = p.id),
		        p.created_at, p.updated_at
		 FROM packs p JOIN users u ON u.id = p.owner_id
		 WHERE ` + joinAnd(conditions) + `
		 ORDER BY p.is_public DESC, p.play_count DESC, p.created_at DESC
		 LIMIT ?`
	args = append(args, query.Limit)
	rows, err := s.conn.Query(queryText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Pack
	for rows.Next() {
		var pack Pack
		var isPublic int
		if err := rows.Scan(&pack.ID, &pack.OwnerID, &pack.OwnerUsername, &pack.Name,
			&pack.Description, &isPublic, &pack.PlayCount, &pack.LocationCount,
			&pack.CreatedAt, &pack.UpdatedAt); err != nil {
			return nil, err
		}
		pack.IsPublic = isPublic != 0
		out = append(out, pack)
	}
	return out, rows.Err()
}

// UpdatePack patches editable fields of a pack owned by the user.
func (s *Store) UpdatePack(id int64, ownerID, name, description string, isPublic bool) error {
	result, err := s.conn.Exec(
		`UPDATE packs SET name = ?, description = ?, is_public = ?, updated_at = ?
		 WHERE id = ? AND owner_id = ?`,
		name, description, boolInt(isPublic), util.Now(), id, ownerID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errNotFound
	}
	return nil
}

// DeletePack removes a pack owned by the user.
func (s *Store) DeletePack(id int64, ownerID string) error {
	result, err := s.conn.Exec(`DELETE FROM packs WHERE id = ? AND owner_id = ?`, id, ownerID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errNotFound
	}
	return nil
}

// ListLocations returns all locations of a pack, in insertion order.
func (s *Store) ListLocations(packID int64) ([]Location, error) {
	rows, err := s.conn.Query(
		`SELECT id, pack_id, name, lat, lng, difficulty, region, image_id, panorama_url
		 FROM pack_locations WHERE pack_id = ? ORDER BY id`, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLocations(rows)
}

// ReplaceLocations atomically replaces a pack's locations in one transaction.
func (s *Store) ReplaceLocations(packID int64, inputs []LocationInput) error {
	tx, err := s.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() // #nosec G307 -- rollback after commit is a no-op

	if _, err := tx.Exec(`DELETE FROM pack_locations WHERE pack_id = ?`, packID); err != nil {
		return err
	}
	for _, input := range inputs {
		if _, err := tx.Exec(
			`INSERT INTO pack_locations (pack_id, name, lat, lng, difficulty, region, image_id, panorama_url, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			packID, input.Name, input.Lat, input.Lng, input.Difficulty, input.Region,
			input.ImageID, input.PanoramaURL, util.Now(), util.Now()); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// FetchPlayableLocations returns the public view of a pack's locations.
func (s *Store) FetchPlayableLocations(packID int64) ([]PublicLocation, error) {
	rows, err := s.conn.Query(
		`SELECT id, name, difficulty, region, image_id, panorama_url
		 FROM pack_locations WHERE pack_id = ? ORDER BY id`, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PublicLocation
	for rows.Next() {
		var location PublicLocation
		var imageID, panoramaURL sql.NullString
		if err := rows.Scan(&location.ID, &location.Name, &location.Difficulty,
			&location.Region, &imageID, &panoramaURL); err != nil {
			return nil, err
		}
		if imageID.Valid {
			location.MapillaryID = &imageID.String
		}
		if panoramaURL.Valid {
			location.PanoramaURL = &panoramaURL.String
		}
		out = append(out, location)
	}
	return out, rows.Err()
}

// FetchByIDs returns full locations for the given IDs, for authoritative
// settlement during game submission.
func (s *Store) FetchByIDs(ids []int64) ([]Location, error) {
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
		`SELECT id, pack_id, name, lat, lng, difficulty, region, image_id, panorama_url
		 FROM pack_locations WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLocations(rows)
}

// IncrementPlayCount bumps the play counter after a play list is served.
func (s *Store) IncrementPlayCount(packID int64) error {
	_, err := s.conn.Exec(
		`UPDATE packs SET play_count = play_count + 1, updated_at = ? WHERE id = ?`,
		util.Now(), packID)
	return err
}

func scanLocations(rows *sql.Rows) ([]Location, error) {
	var out []Location
	for rows.Next() {
		var location Location
		var imageID, panoramaURL sql.NullString
		if err := rows.Scan(&location.ID, &location.PackID, &location.Name, &location.Lat,
			&location.Lng, &location.Difficulty, &location.Region, &imageID, &panoramaURL); err != nil {
			return nil, err
		}
		if imageID.Valid {
			location.ImageID = &imageID.String
		}
		if panoramaURL.Valid {
			location.PanoramaURL = &panoramaURL.String
		}
		out = append(out, location)
	}
	return out, rows.Err()
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func joinAnd(conditions []string) string {
	out := conditions[0]
	for _, c := range conditions[1:] {
		out += " AND " + c
	}
	return out
}
