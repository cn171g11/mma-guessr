package auth

import (
	"log/slog"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/mail"
)

// Service orchestrates the auth flows (register, login, refresh, guest).
type Service struct {
	store               *Store
	verify              *VerificationStore
	refresh             *RefreshStore
	tokens              *TokenService
	loginGuard          *LoginGuard
	mailer              mail.Config
	logger              *slog.Logger
	environment         string
	accessTTLSeconds    int
	refreshTTLSeconds   int
	guestTTLSeconds     int
	verifyTTLSeconds    int
	verifyMaxAttempts   int
	verifyResendSeconds int
}

// NewService assembles the auth Service from its dependencies.
func NewService(
	store *Store,
	verify *VerificationStore,
	refresh *RefreshStore,
	tokens *TokenService,
	loginGuard *LoginGuard,
	mailer mail.Config,
	logger *slog.Logger,
	environment string,
	accessTTLSeconds, refreshTTLSeconds, guestTTLSeconds int,
	verifyTTLSeconds, verifyMaxAttempts, verifyResendSeconds int,
) *Service {
	return &Service{
		store: store, verify: verify, refresh: refresh, tokens: tokens,
		loginGuard: loginGuard, mailer: mailer, logger: logger, environment: environment,
		accessTTLSeconds:  accessTTLSeconds,
		refreshTTLSeconds: refreshTTLSeconds, guestTTLSeconds: guestTTLSeconds,
		verifyTTLSeconds: verifyTTLSeconds, verifyMaxAttempts: verifyMaxAttempts,
		verifyResendSeconds: verifyResendSeconds,
	}
}

// SendVerificationCode issues a code and delivers it. The same response is
// returned regardless of whether the email is registered (anti-enumeration).
func (s *Service) SendVerificationCode(email string) error {
	code, httpErr := s.verify.SendCode(email, s.verifyTTLSeconds, s.verifyResendSeconds)
	if httpErr != nil {
		return httpErr
	}

	if s.mailer.Enabled() {
		subject := "MmaGuessr 验证码"
		body := "你的验证码是: " + code + "\n10 分钟内有效。若非本人操作请忽略。"
		if err := s.mailer.Send(email, subject, body); err != nil {
			s.logger.Error("send verification email", "error", err, "email", email)
			return httputil.New(500, "验证码发送失败")
		}
		return nil
	}

	// Without SMTP, the code can only be surfaced to the operator log, and
	// only outside production.
	if s.environment == "production" {
		s.logger.Error("verification email not configured but required in production", "email", email)
		return httputil.New(500, "验证码发送失败")
	}
	s.logger.Info("verification code (dev fallback)", "email", email, "code", code)
	return nil
}

// AccountSession is the login/register success payload.
type AccountSession struct {
	User      PublicUser `json:"user"`
	TokenPair TokenPair  `json:"tokenPair"`
}

// GuestSessionResponse is the create-guest payload.
type GuestSessionResponse struct {
	GuestID    string `json:"guestId"`
	GuestToken string `json:"guestToken"`
	Username   string `json:"username"`
}

var dummyPasswordHash string

func verifyConstantTime(password string, storedHash *string) bool {
	if storedHash == nil || *storedHash == "" {
		if dummyPasswordHash == "" {
			hash, err := bcrypt.GenerateFromPassword([]byte("timing-equal-dummy-password"), bcryptCost)
			if err == nil {
				dummyPasswordHash = string(hash)
			}
		}
		if dummyPasswordHash != "" {
			_ = bcrypt.CompareHashAndPassword([]byte(dummyPasswordHash), []byte(password))
		}
		return false
	}
	return VerifyPassword(*storedHash, password)
}

// IssueTokenPair signs an access+refresh pair and stores the refresh hash.
func (s *Service) IssueTokenPair(userID string) (*TokenPair, error) {
	accessToken, err := s.tokens.SignAccessToken(userID, RoleUser)
	if err != nil {
		return nil, err
	}
	refreshToken, err := s.tokens.SignRefreshToken(userID)
	if err != nil {
		return nil, err
	}
	if err := s.refresh.Store(userID, refreshToken, s.refreshTTLSeconds); err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, nil
}

// MeProgress returns the progress snapshot for the given identity.
func (s *Service) MeProgress(role, subject string) (*Progress, error) {
	if role == RoleGuest {
		return s.store.GetGuestProgress(subject)
	}
	if err := s.store.EnsureUserProgress(subject); err != nil {
		return nil, err
	}
	return s.store.GetUserProgress(subject)
}

// GuestProfile returns the guest session record, or nil when absent.
func (s *Service) GuestProfile(guestID string) (*GuestSession, error) {
	return s.store.GetGuest(guestID)
}

// UserProfile returns the public user profile for an ID.
func (s *Service) UserProfile(userID string) (*PublicUser, error) {
	user, err := s.store.FindByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, httputil.NotFound("用户不存在")
	}
	pub := user.ToPublic()
	return &pub, nil
}

// IsEmailRegistered reports whether an email already belongs to an account.
func (s *Service) IsEmailRegistered(email string) (bool, error) {
	return s.verify.IsEmailRegistered(email)
}

// RegisterAccount creates a user, optionally merges guest progress, and
// issues a token pair.
func (s *Service) RegisterAccount(username, email, password, verificationCode string, guestID *string) (*AccountSession, error) {
	if err := ValidateRegistration(username, email, password); err != nil {
		return nil, err
	}
	if err := s.verify.ConsumeCode(email, verificationCode, s.verifyMaxAttempts); err != nil {
		return nil, err
	}

	passwordHash, err := HashPassword(password)
	if err != nil {
		return nil, httputil.BadRequest("密码过长（UTF-8 编码后不得超过 72 字节）")
	}

	user, err := s.store.CreateUser(username, email, passwordHash)
	if err != nil {
		return nil, err
	}
	if err := s.store.EnsureUserProgress(user.ID); err != nil {
		return nil, err
	}

	if guestID != nil && *guestID != "" {
		if err := s.store.MergeGuestProgressIntoUser(*guestID, user.ID); err != nil {
			// Best-effort merge; a failure must not block account creation.
			_ = err
		}
	}

	pair, err := s.IssueTokenPair(user.ID)
	if err != nil {
		return nil, err
	}
	return &AccountSession{User: user.ToPublic(), TokenPair: *pair}, nil
}

// LoginAccount verifies credentials with brute-force protection and returns
// a session on success.
func (s *Service) LoginAccount(identifier, password string) (*AccountSession, error) {
	normalized := strings.ToLower(identifier)
	lockKey := normalized

	if s.loginGuard.IsLocked(lockKey) {
		return nil, httputil.Unauthorized("尝试次数过多, 账号已临时锁定, 请稍后再试")
	}

	user, err := s.store.FindByIdentifier(normalized)
	if err != nil {
		return nil, err
	}

	var storedHash *string
	if user != nil {
		storedHash = &user.PasswordHash
	}
	verified := verifyConstantTime(password, storedHash)

	if user == nil || !verified {
		s.loginGuard.RecordFailure(lockKey)
		return nil, httputil.Unauthorized("账号或密码错误")
	}

	s.loginGuard.Reset(lockKey)
	pair, err := s.IssueTokenPair(user.ID)
	if err != nil {
		return nil, err
	}
	return &AccountSession{User: user.ToPublic(), TokenPair: *pair}, nil
}

// ExchangeRefreshToken validates a refresh token and rotates it.
func (s *Service) ExchangeRefreshToken(refreshToken string) (*TokenPair, error) {
	claims, err := s.tokens.VerifyRefreshToken(refreshToken)
	if err != nil {
		return nil, httputil.Unauthorized("刷新令牌无效")
	}

	newAccess, err := s.tokens.SignAccessToken(claims.Subject, RoleUser)
	if err != nil {
		return nil, err
	}
	newRefresh, err := s.tokens.SignRefreshToken(claims.Subject)
	if err != nil {
		return nil, err
	}

	ok, err := s.refresh.Exchange(claims.Subject, refreshToken, newRefresh, s.refreshTTLSeconds)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httputil.Unauthorized("刷新令牌无效")
	}
	return &TokenPair{AccessToken: newAccess, RefreshToken: newRefresh}, nil
}

// RevokeTokens clears the user's stored refresh token (logout).
func (s *Service) RevokeTokens(userID string) error {
	return s.refresh.Revoke(userID)
}

// CreateGuest creates a guest session and returns its public payload.
func (s *Service) CreateGuest() (*GuestSessionResponse, error) {
	guest, err := s.store.CreateGuest(s.guestTTLSeconds)
	if err != nil {
		return nil, err
	}
	token, err := s.tokens.SignAccessToken(guest.GuestID, RoleGuest)
	if err != nil {
		return nil, err
	}
	return &GuestSessionResponse{
		GuestID:    guest.GuestID,
		GuestToken: token,
		Username:   guest.Username,
	}, nil
}

// MeProfile returns the authenticated caller's profile and progress.
type MeProfile struct {
	Role     string        `json:"role"`
	User     *PublicUser   `json:"user,omitempty"`
	Profile  *GuestSession `json:"profile,omitempty"`
	Progress *Progress     `json:"progress"`
}

// Me resolves the /me response for a user or guest identity.
func (s *Service) Me(role, subject string) (*MeProfile, error) {
	if role == RoleGuest {
		guest, err := s.store.GetGuest(subject)
		if err != nil {
			return nil, err
		}
		if guest == nil {
			return nil, httputil.Unauthorized("游客会话不存在或已过期")
		}
		progress, err := s.store.GetGuestProgress(subject)
		if err != nil {
			return nil, err
		}
		return &MeProfile{Role: RoleGuest, Profile: guest, Progress: progress}, nil
	}

	user, err := s.store.FindByID(subject)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, httputil.Unauthorized("用户不存在")
	}
	if err := s.store.EnsureUserProgress(subject); err != nil {
		return nil, err
	}
	progress, err := s.store.GetUserProgress(subject)
	if err != nil {
		return nil, err
	}
	pub := user.ToPublic()
	return &MeProfile{Role: RoleUser, User: &pub, Progress: progress}, nil
}
