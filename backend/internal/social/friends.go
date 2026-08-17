package social

import (
	"database/sql"
	"errors"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

// Friend is an accepted friendship from the perspective of one user.
type Friend struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Since    string `json:"since"`
}

// FriendRequest is a pending request with the other party's profile.
type FriendRequest struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	CreatedAt string `json:"createdAt"`
}

// Service handles friends and sponsors.
type Service struct {
	conn *sql.DB
}

// NewService creates a social Service.
func NewService(conn *sql.DB) *Service {
	return &Service{conn: conn}
}

var errUserNotFound = httputil.NotFound("用户不存在")

// ResolveUserID resolves a user id or, when the value is not a valid UUID
// shape, a username into a user id. It is the input layer for friend requests
// so the frontend can add friends by display name.
func (s *Service) ResolveUserID(idOrUsername string) (string, error) {
	var id string
	err := s.conn.QueryRow(
		`SELECT id FROM users WHERE id = ? OR username = ?`, idOrUsername, idOrUsername).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errUserNotFound
	}
	return id, err
}

// SendRequest sends a friendship request from one user to another.
func (s *Service) SendRequest(from, to string) error {
	if from == to {
		return httputil.BadRequest("不能添加自己为好友")
	}
	var exists int
	err := s.conn.QueryRow(`SELECT COUNT(1) FROM users WHERE id = ?`, to).Scan(&exists)
	if err != nil {
		return err
	}
	if exists == 0 {
		return errUserNotFound
	}

	var status string
	err = s.conn.QueryRow(`
		SELECT status FROM friends
		WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
	`, from, to, to, from).Scan(&status)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, err = s.conn.Exec(
			`INSERT INTO friends (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`,
			from, to, util.Now(), util.Now())
		return err
	case err != nil:
		return err
	case status == "accepted":
		return httputil.Conflict("你们已经是好友")
	case status == "pending":
		return httputil.Conflict("好友请求已存在")
	case status == "rejected":
		// Re-open the previously rejected request so the addressee can accept.
		_, err = s.conn.Exec(
			`UPDATE friends SET status = 'pending', updated_at = ? WHERE requester_id = ? AND addressee_id = ?`,
			util.Now(), from, to)
		return err
	default:
		return httputil.Conflict("请稍后重试")
	}
}

// Accept confirms an incoming request. Only the addressee may accept.
func (s *Service) Accept(me, requester string) error {
	res, err := s.conn.Exec(`
		UPDATE friends SET status = 'accepted', updated_at = ?
		WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'
	`, util.Now(), requester, me)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return httputil.NotFound("没有待处理的请求")
	}
	return nil
}

// Reject dismisses an incoming request. Only the addressee may reject.
func (s *Service) Reject(me, requester string) error {
	res, err := s.conn.Exec(`
		UPDATE friends SET status = 'rejected', updated_at = ?
		WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'
	`, util.Now(), requester, me)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return httputil.NotFound("没有待处理的请求")
	}
	return nil
}

// Remove deletes a friendship between two users in either direction.
func (s *Service) Remove(me, other string) error {
	res, err := s.conn.Exec(`
		DELETE FROM friends
		WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
	`, me, other, other, me)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return httputil.NotFound("你们不是好友")
	}
	return nil
}

// AreFriends reports whether the two users have an accepted friendship.
func (s *Service) AreFriends(a, b string) (bool, error) {
	var status string
	err := s.conn.QueryRow(`
		SELECT status FROM friends
		WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
		  AND status = 'accepted'
	`, a, b, b, a).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ListFriends returns all accepted friendships for a user.
func (s *Service) ListFriends(me string) ([]Friend, error) {
	rows, err := s.conn.Query(`
		SELECT u.id, u.username, f.updated_at
		FROM friends f
		JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
		WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
		ORDER BY f.updated_at DESC
	`, me, me, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	friends := make([]Friend, 0, 8)
	for rows.Next() {
		var f Friend
		if err := rows.Scan(&f.ID, &f.Username, &f.Since); err != nil {
			return nil, err
		}
		friends = append(friends, f)
	}
	return friends, rows.Err()
}

// ListRequests returns incoming (others requesting me) and outgoing (my
// pending requests) separately.
func (s *Service) ListRequests(me string) (incoming, outgoing []FriendRequest, err error) {
	incoming, err = s.listIncomingRequests(me)
	if err != nil {
		return nil, nil, err
	}
	outgoing, err = s.listOutgoingRequests(me)
	if err != nil {
		return nil, nil, err
	}
	return incoming, outgoing, nil
}

// listIncomingRequests lists pending rows where the user is the addressee
// (someone asked to be friends with the user).
func (s *Service) listIncomingRequests(me string) ([]FriendRequest, error) {
	return s.queryPendingRequests(`
		SELECT u.id, u.username, f.created_at
		FROM friends f
		JOIN users u ON u.id = f.requester_id
		WHERE f.addressee_id = ? AND f.status = 'pending'
		ORDER BY f.created_at DESC
	`, me)
}

// listOutgoingRequests lists pending rows where the user is the requester
// (requests the user sent that have not been answered yet).
func (s *Service) listOutgoingRequests(me string) ([]FriendRequest, error) {
	return s.queryPendingRequests(`
		SELECT u.id, u.username, f.created_at
		FROM friends f
		JOIN users u ON u.id = f.addressee_id
		WHERE f.requester_id = ? AND f.status = 'pending'
		ORDER BY f.created_at DESC
	`, me)
}

// queryPendingRequests runs a fixed pending-request query and scans rows.
func (s *Service) queryPendingRequests(query, me string) ([]FriendRequest, error) {
	rows, err := s.conn.Query(query, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	requests := make([]FriendRequest, 0, 4)
	for rows.Next() {
		var r FriendRequest
		if err := rows.Scan(&r.ID, &r.Username, &r.CreatedAt); err != nil {
			return nil, err
		}
		requests = append(requests, r)
	}
	return requests, rows.Err()
}
