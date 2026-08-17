package oauth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/signature"
)

// Provider is a third-party OAuth2 authorization-code provider.
type Provider interface {
	Name() string
	Label() string
	// AuthorizeURL builds the provider's consent URL. The state parameter is
	// the signed CSRF token issued by BuildState.
	AuthorizeURL(state string) string
	// ExchangeCode trades the authorization code for the provider identity.
	// The caller must only call this with a verified state.
	ExchangeCode(ctx context.Context, code string) (*Identity, error)
}

// Identity is the minimal provider profile needed to bind an account.
type Identity struct {
	ProviderID string
	Email      string
	Name       string
}

// ProviderInfo is the public provider descriptor.
type ProviderInfo struct {
	Name  string `json:"name"`
	Label string `json:"label"`
}

const (
	stateTTL = 10 * time.Minute

	// Google public API endpoints; the tokens below are never embedded.
	googleAuthURL     = "https://accounts.google.com/o/oauth2/v2/auth"       // #nosec G101 -- public endpoint, not a credential
	googleTokenURL    = "https://oauth2.googleapis.com/token"                 // #nosec G101 -- public endpoint, not a credential
	googleUserInfoURL = "https://openidconnect.googleapis.com/v1/userinfo"    // #nosec G101 -- public endpoint, not a credential
)

// GoogleProvider implements the authorization-code flow for Google.
type GoogleProvider struct {
	clientID     string
	clientSecret string
	redirectURI  string
	client       *http.Client
}

// NewGoogleProvider creates a Google OAuth provider. The redirect URI is the
// exact backend callback URL and is validated against a whitelist at config
// load time.
func NewGoogleProvider(clientID, clientSecret, redirectURI string) *GoogleProvider {
	return &GoogleProvider{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		client:       &http.Client{Timeout: 10 * time.Second},
	}
}

// Name returns the provider key used in URLs and storage.
func (p *GoogleProvider) Name() string { return "google" }

// Label returns the human-readable provider name.
func (p *GoogleProvider) Label() string { return "Google" }

// AuthorizeURL builds the Google consent URL for the given state.
func (p *GoogleProvider) AuthorizeURL(state string) string {
	params := url.Values{}
	params.Set("client_id", p.clientID)
	params.Set("redirect_uri", p.redirectURI)
	params.Set("response_type", "code")
	params.Set("scope", "openid email profile")
	params.Set("access_type", "online")
	params.Set("prompt", "select_account")
	params.Set("state", state)
	return googleAuthURL + "?" + params.Encode()
}

// ExchangeCode exchanges the authorization code and fetches the user profile.
func (p *GoogleProvider) ExchangeCode(ctx context.Context, code string) (*Identity, error) {
	token, err := p.fetchToken(ctx, code)
	if err != nil {
		return nil, err
	}
	return p.fetchUserInfo(ctx, token)
}

func (p *GoogleProvider) fetchToken(ctx context.Context, code string) (string, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", p.clientID)
	form.Set("client_secret", p.clientSecret)
	form.Set("redirect_uri", p.redirectURI)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", httputil.New(500, "OAuth 服务暂不可用")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := p.client.Do(req)
	if err != nil {
		return "", httputil.New(500, "OAuth 服务暂不可用")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", httputil.Unauthorized("第三方授权失败")
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", httputil.New(500, "OAuth 响应异常")
	}
	if payload.Error != "" || payload.AccessToken == "" {
		return "", httputil.Unauthorized("第三方授权失败")
	}
	return payload.AccessToken, nil
}

func (p *GoogleProvider) fetchUserInfo(ctx context.Context, accessToken string) (*Identity, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleUserInfoURL, nil)
	if err != nil {
		return nil, httputil.New(500, "OAuth 服务暂不可用")
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, httputil.New(500, "OAuth 服务暂不可用")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, httputil.Unauthorized("第三方授权失败")
	}
	var info struct {
		Sub  string `json:"sub"`
		Mail string `json:"email"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&info); err != nil {
		return nil, httputil.New(500, "OAuth 响应异常")
	}
	if info.Sub == "" {
		return nil, httputil.Unauthorized("第三方授权失败")
	}
	return &Identity{ProviderID: info.Sub, Email: info.Mail, Name: info.Name}, nil
}

// Service issues and verifies signed OAuth state tokens, preventing login
// CSRF and callback replay. States are single-use: a successful verification
// consumes the token so a captured authorize URL cannot be replayed.
type Service struct {
	providers   map[string]Provider
	stateSecret []byte

	mu         sync.Mutex
	usedStates map[string]time.Time // state token -> when it was consumed
}

// NewService creates an OAuth Service. The state secret must be stable across
// restarts so in-flight authorization redirects keep validating.
func NewService(stateSecret string, providers ...Provider) *Service {
	svc := &Service{
		providers:   make(map[string]Provider),
		stateSecret: []byte(stateSecret),
		usedStates:  make(map[string]time.Time),
	}
	for _, p := range providers {
		svc.providers[p.Name()] = p
	}
	return svc
}

// Providers lists the configured providers.
func (s *Service) Providers() []ProviderInfo {
	out := make([]ProviderInfo, 0, len(s.providers))
	for _, p := range s.providers {
		out = append(out, ProviderInfo{Name: p.Name(), Label: p.Label()})
	}
	return out
}

// Provider returns the provider by name, or nil when not configured.
func (s *Service) Provider(name string) (Provider, bool) {
	p, ok := s.providers[name]
	return p, ok
}

// BuildState signs a state token binding a provider name, an issue time and a
// random nonce. The nonce makes every token unique, so a consumed token can
// never be replayed.
func (s *Service) BuildState(provider string) (string, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", err
	}
	payload := fmt.Sprintf("%s:%d:%s", provider, time.Now().UnixMilli(), hex.EncodeToString(nonce[:]))
	mac := s.stateMAC(payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(mac), nil
}

// VerifyState checks the signed state token: integrity, provider match,
// freshness and single-use consumption (defense against CSRF and replay).
func (s *Service) VerifyState(state, provider string) error {
	if state == "" {
		return httputil.BadRequest("缺少 state 参数")
	}
	parts := strings.SplitN(state, ".", 2)
	if len(parts) != 2 {
		return httputil.BadRequest("state 格式非法")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return httputil.BadRequest("state 格式非法")
	}
	expectedMAC := hex.EncodeToString(s.stateMAC(string(payload)))
	if !signature.ConstantTimeEquals(expectedMAC, parts[1]) {
		return httputil.BadRequest("state 校验失败")
	}
	fields := strings.SplitN(string(payload), ":", 3)
	if len(fields) != 3 || fields[0] != provider {
		return httputil.BadRequest("state 与回调不匹配")
	}
	var ts int64
	if _, err := fmt.Sscanf(fields[1], "%d", &ts); err != nil {
		return httputil.BadRequest("state 格式非法")
	}
	if now := time.Now().UnixMilli(); now-ts > stateTTL.Milliseconds() || ts-now > stateTTL.Milliseconds() {
		return httputil.BadRequest("state 已过期")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepUsedStates(time.Now())
	if _, ok := s.usedStates[state]; ok {
		return httputil.BadRequest("state 已使用")
	}
	s.usedStates[state] = time.Now()
	return nil
}

// sweepUsedStates drops consumed tokens that fell out of the TTL window so
// the map stays bounded by the number of callbacks per 10 minutes.
func (s *Service) sweepUsedStates(now time.Time) {
	for token, usedAt := range s.usedStates {
		if now.Sub(usedAt) > stateTTL {
			delete(s.usedStates, token)
		}
	}
}

func (s *Service) stateMAC(payload string) []byte {
	mac := hmac.New(sha256.New, s.stateSecret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}
