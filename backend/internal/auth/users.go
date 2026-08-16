package auth

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/util"
)

// User is a registered account record.
type User struct {
	ID            string  `json:"id"`
	Username      string  `json:"username"`
	Email         string  `json:"email"`
	PasswordHash  string  `json:"-"`
	EquippedTitle *string `json:"-"`
	CreatedAt     string  `json:"createdAt"`
}

var (
	usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)
	emailRe    = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

// Store provides data access for the auth domain.
type Store struct {
	conn *sql.DB
}

// NewStore creates an auth Store backed by the given connection.
func NewStore(conn *sql.DB) *Store {
	return &Store{conn: conn}
}

// PublicUser is the user shape returned to clients (no password hash).
type PublicUser struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
}

// ToPublic converts a User to its public representation.
func (u *User) ToPublic() PublicUser {
	return PublicUser{
		ID:        u.ID,
		Username:  u.Username,
		Email:     u.Email,
		CreatedAt: u.CreatedAt,
	}
}

// ValidateRegistration checks username/email/password rules up front.
func ValidateRegistration(username, email, password string) *httputil.HttpError {
	if !usernameRe.MatchString(username) {
		return httputil.BadRequest("用户名需为 3-20 位字母、数字或下划线")
	}
	if !emailRe.MatchString(email) {
		return httputil.BadRequest("邮箱格式非法")
	}
	if len(password) < 8 || len(password) > 72 {
		return httputil.BadRequest("密码长度需为 8-72 位")
	}
	return nil
}

// NormalizeEmail trims and lowercases an email address.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// IsValidEmail reports whether the address matches the accepted pattern.
func IsValidEmail(email string) bool {
	return emailRe.MatchString(email)
}

// ValidateLogin checks that both login fields are present.
func ValidateLogin(identifier, password string) *httputil.HttpError {
	if strings.TrimSpace(identifier) == "" {
		return httputil.BadRequest("请输入账号")
	}
	if password == "" {
		return httputil.BadRequest("请输入密码")
	}
	return nil
}

// ValidateCode checks the 6-digit verification code format.
func ValidateCode(code string) *httputil.HttpError {
	if len(code) != 6 {
		return httputil.BadRequest("验证码格式不正确")
	}
	for i := 0; i < len(code); i++ {
		if code[i] < '0' || code[i] > '9' {
			return httputil.BadRequest("验证码格式不正确")
		}
	}
	return nil
}

// CreateUser inserts a new user and returns the created record. It returns an
// HttpError 409 when username or email is already taken.
func (s *Store) CreateUser(username, email, passwordHash string) (*User, error) {
	id := util.NewUUID()
	now := util.Now()
	_, err := s.conn.Exec(
		`INSERT INTO users (id, username, email, password_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, username, strings.ToLower(email), passwordHash, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, httputil.Conflict("用户名或邮箱已被占用")
		}
		return nil, err
	}
	return &User{
		ID:           id,
		Username:     username,
		Email:        strings.ToLower(email),
		PasswordHash: passwordHash,
		CreatedAt:    now,
	}, nil
}

// FindByEmail looks up a user by normalized email.
func (s *Store) FindByEmail(email string) (*User, error) {
	return s.findByField("email", strings.ToLower(email))
}

// FindByUsername looks up a user by username.
func (s *Store) FindByUsername(username string) (*User, error) {
	return s.findByField("username", username)
}

// FindByID looks up a user by ID.
func (s *Store) FindByID(id string) (*User, error) {
	return s.findByField("id", id)
}

// FindByIdentifier looks up a user by email or username (login).
func (s *Store) FindByIdentifier(identifier string) (*User, error) {
	if strings.Contains(identifier, "@") {
		return s.FindByEmail(identifier)
	}
	return s.FindByUsername(identifier)
}

func (s *Store) findByField(field, value string) (*User, error) {
	// Only allow fields from a fixed allowlist so the column name can never
	// be attacker-controlled (the rest of the query is parameterized).
	switch field {
	case "id", "email", "username":
	default:
		return nil, errors.New("invalid lookup field")
	}
	row := s.conn.QueryRow(
		`SELECT id, username, email, password_hash, equipped_title, created_at
		 FROM users WHERE `+field+` = ?`, value) // #nosec G202 -- field is allowlisted above, value is parameterized
	return scanUser(row)
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var equipped sql.NullString
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &equipped, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if equipped.Valid {
		u.EquippedTitle = &equipped.String
	}
	return &u, nil
}

// SetEquippedTitle updates a user's equipped title.
func (s *Store) SetEquippedTitle(userID string, title *string) error {
	_, err := s.conn.Exec(
		`UPDATE users SET equipped_title = ?, updated_at = ? WHERE id = ?`,
		title, util.Now(), userID)
	return err
}

// UpdateTimestamp bumps a user's updated_at (used on login).
func (s *Store) Touch(userID string) error {
	_, err := s.conn.Exec(`UPDATE users SET updated_at = ? WHERE id = ?`, util.Now(), userID)
	return err
}

func isUniqueViolation(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "UNIQUE constraint failed") ||
		strings.Contains(err.Error(), "constraint failed"))
}

// TokenPair groups the tokens returned on auth success.
type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
}
