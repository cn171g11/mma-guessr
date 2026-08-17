package social

import (
	"database/sql"
	"errors"
	"strings"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

// Sponsor is one entry of the public thank-you list.
type Sponsor struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Note        string `json:"note"`
	AmountCents int64  `json:"amountCents"`
	Visible     bool   `json:"visible"`
	CreatedAt   string `json:"createdAt"`
}

// ListSponsors returns all visible sponsor entries, biggest donors first.
func (s *Service) ListSponsors() ([]Sponsor, error) {
	rows, err := s.conn.Query(`
		SELECT id, name, note, amount_cents, created_at
		FROM sponsors
		WHERE visible = 1
		ORDER BY amount_cents DESC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sponsors := make([]Sponsor, 0, 8)
	for rows.Next() {
		var (
			sp  Sponsor
			amt int64
		)
		if err := rows.Scan(&sp.ID, &sp.Name, &sp.Note, &amt, &sp.CreatedAt); err != nil {
			return nil, err
		}
		sp.AmountCents = amt
		sp.Visible = true
		sponsors = append(sponsors, sp)
	}
	return sponsors, rows.Err()
}

// AddSponsor records a sponsorship. Only the owner (via admin token) calls it.
func (s *Service) AddSponsor(name string, note string, amountCents int64, visible bool) (int64, error) {
	name = trimSpace(name)
	if name == "" {
		return 0, httputil.BadRequest("赞助者名称不能为空")
	}
	if amountCents < 0 {
		amountCents = 0
	}
	v := 0
	if visible {
		v = 1
	}
	res, err := s.conn.Exec(
		`INSERT INTO sponsors (name, note, amount_cents, visible, created_at) VALUES (?, ?, ?, ?, ?)`,
		name, trimSpace(note), amountCents, v, util.Now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// DeleteSponsor removes a sponsorship record.
func (s *Service) DeleteSponsor(id int64) error {
	res, err := s.conn.Exec(`DELETE FROM sponsors WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return httputil.NotFound("记录不存在")
	}
	return nil
}

// LookupSponsorName maps a display name to a stable ID, or errors. Kept for
// future donation verification hooks.
func (s *Service) LookupSponsorName(name string) (int64, error) {
	var id int64
	err := s.conn.QueryRow(`SELECT id FROM sponsors WHERE name = ? AND visible = 1`, trimSpace(name)).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, httputil.NotFound("记录不存在")
	}
	return id, err
}

func trimSpace(v string) string {
	return strings.TrimSpace(v)
}