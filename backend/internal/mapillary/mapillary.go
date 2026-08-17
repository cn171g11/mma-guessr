package mapillary

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/kv"
)

const (
	graphBaseURL     = "https://graph.mapillary.com"
	mediaFields      = "thumb_256_url,thumb_1024_url,thumb_2048_url"
	searchFields     = "id,geometry,is_pano,thumb_256_url,thumb_1024_url,thumb_2048_url"
	imageContentType = "image/jpeg"

	searchCachePrefix = "mly:search:"
	mediaCachePrefix  = "mly:media:"
	imageCachePrefix  = "mly:img:"

	allowedWidths  = 256
	largestWidth   = 2048
	maxImageBytes  = 1 << 20
	defaultTimeout = 10 * time.Second
)

// BBoxPattern describes minLng,minLat,maxLng,maxLat (decimal, negatives ok).

// SearchResult mirrors the Mapillary /images response.
type SearchResult struct {
	Data []Image `json:"data"`
}

// Image is one Mapillary image entry.
type Image struct {
	ID           string    `json:"id"`
	Thumb256URL  *string   `json:"thumb_256_url,omitempty"`
	Thumb1024URL *string   `json:"thumb_1024_url,omitempty"`
	Thumb2048URL *string   `json:"thumb_2048_url,omitempty"`
	Geometry     struct {
		Type        string    `json:"type"`
		Coordinates []float64 `json:"coordinates"`
	} `json:"geometry"`
	IsPano *bool `json:"is_pano,omitempty"`
}

// FetchedImage is the resolved thumbnail bytes.
type FetchedImage struct {
	Buffer      []byte
	ContentType string
}

// Service proxies Mapillary search and imagery with server-held secrets.
type Service struct {
	token        string
	kv           *kv.Store
	client       *http.Client
	baseURL      string
	imageFetcher func(string) ([]byte, error)
}

// NewService creates a Mapillary proxy service.
func NewService(token string, cache *kv.Store) *Service {
	return &Service{
		token:   token,
		kv:      cache,
		client:  &http.Client{Timeout: defaultTimeout},
		baseURL: graphBaseURL,
	}
}

// SetUpstream overrides the upstream base URL and client (tests only).
func (s *Service) SetUpstream(baseURL string, client *http.Client) {
	if baseURL != "" {
		s.baseURL = baseURL
	}
	if client != nil {
		s.client = client
	}
}

// SetToken overrides the Mapillary access token (tests only).
func (s *Service) SetToken(token string) {
	s.token = token
}

// SetImageFetcher overrides the downstream image fetch (tests only). The
// SSRF guard still runs before the fetcher is invoked.
func (s *Service) SetImageFetcher(fetcher func(string) ([]byte, error)) {
	s.imageFetcher = fetcher
}

// IsValidBBox reports whether the bbox string matches the expected format.
func IsValidBBox(bbox string) bool {
	parts := strings.Split(bbox, ",")
	if len(parts) != 4 {
		return false
	}
	for _, part := range parts {
		if !isDecimal(part) {
			return false
		}
	}
	return true
}

func isDecimal(value string) bool {
	if value == "" {
		return false
	}
	hasDot := false
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c == '-' {
			if i != 0 {
				return false
			}
			continue
		}
		if c == '.' {
			if hasDot {
				return false
			}
			hasDot = true
			continue
		}
		if c < '0' || c > '9' {
			return false
		}
	}
	return !hasDot || value != "."
}

// SearchImages queries the Mapillary image search with a cached result.
func (s *Service) SearchImages(bbox string, limit int) (*SearchResult, error) {
	if s.token == "" {
		return nil, httputil.ServiceUnavailable("Mapillary 代理未配置（缺少 MAPILLARY_TOKEN）")
	}
	cacheKey := searchCachePrefix + bbox + ":" + fmt.Sprint(limit)
	if cached, ok := s.kv.Get(cacheKey); ok {
		var result SearchResult
		if err := json.Unmarshal([]byte(cached), &result); err == nil {
			return &result, nil
		}
	}

	params := url.Values{}
	params.Set("access_token", s.token)
	params.Set("fields", searchFields)
	params.Set("bbox", bbox)
	params.Set("limit", fmt.Sprint(limit))
	raw, err := s.requestJSON(s.baseURL + "/images?" + params.Encode())
	if err != nil {
		return nil, err
	}

	var result SearchResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 服务暂不可用（响应格式异常）")
	}
	_ = s.kv.Set(cacheKey, string(raw), 24*60*60)
	return &result, nil
}

// FetchImage resolves and proxies a thumbnail, caching the bytes.
func (s *Service) FetchImage(imageID string, width int) (*FetchedImage, error) {
	if s.token == "" {
		return nil, httputil.ServiceUnavailable("Mapillary 代理未配置（缺少 MAPILLARY_TOKEN）")
	}
	normalized := normalizeWidth(width)
	cacheKey := imageCachePrefix + imageID + ":" + fmt.Sprint(normalized)
	if cached, ok := s.kv.GetBytes(cacheKey); ok {
		return &FetchedImage{Buffer: cached, ContentType: imageContentType}, nil
	}

	media, err := s.resolveMedia(imageID)
	if err != nil {
		return nil, err
	}
	thumbURL, err := pickThumbURL(media, normalized)
	if err != nil {
		return nil, err
	}
	buffer, err := s.fetchImage(thumbURL)
	if err != nil {
		return nil, err
	}
	_ = s.kv.SetBytes(cacheKey, buffer, 24*60*60)
	return &FetchedImage{Buffer: buffer, ContentType: imageContentType}, nil
}

// ResolveMediaURL resolves a Mapillary image to its public CDN thumbnail URL.
// Unlike FetchImage it never downloads bytes, so the browser can load the
// image directly from the CDN while the token stays server-side.
func (s *Service) ResolveMediaURL(imageID string, width int) (string, error) {
	if s.token == "" {
		return "", httputil.ServiceUnavailable("Mapillary 代理未配置（缺少 MAPILLARY_TOKEN）")
	}
	media, err := s.resolveMedia(imageID)
	if err != nil {
		return "", err
	}
	thumbURL, err := pickThumbURL(media, normalizeWidth(width))
	if err != nil {
		return "", err
	}
	if err := assertSafeImageURL(thumbURL); err != nil {
		return "", err
	}
	return thumbURL, nil
}

type mediaRecord struct {
	Thumb256URL  *string `json:"thumb_256_url"`
	Thumb1024URL *string `json:"thumb_1024_url"`
	Thumb2048URL *string `json:"thumb_2048_url"`
}

func (s *Service) resolveMedia(imageID string) (*mediaRecord, error) {
	cacheKey := mediaCachePrefix + imageID
	if cached, ok := s.kv.Get(cacheKey); ok {
		var media mediaRecord
		if err := json.Unmarshal([]byte(cached), &media); err == nil {
			return &media, nil
		}
	}
	params := url.Values{}
	params.Set("access_token", s.token)
	params.Set("fields", mediaFields)
	raw, err := s.requestJSON(s.baseURL + "/" + imageID + "?" + params.Encode())
	if err != nil {
		return nil, err
	}
	var media mediaRecord
	if err := json.Unmarshal(raw, &media); err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 服务暂不可用（响应格式异常）")
	}
	_ = s.kv.Set(cacheKey, string(raw), 24*60*60)
	return &media, nil
}

func (s *Service) requestJSON(target string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 服务暂不可用")
	}
	req.Header.Set("User-Agent", "mma-guessr-backend")
	response, err := s.client.Do(req)
	if err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 请求超时")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, mapUpstreamError(response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 服务暂不可用")
	}
	return raw, nil
}

func mapUpstreamError(status int) error {
	switch status {
	case http.StatusTooManyRequests:
		return httputil.TooManyRequests("Mapillary 请求超出额度，请稍后再试")
	case http.StatusUnauthorized, http.StatusForbidden:
		return httputil.ServiceUnavailable("Mapillary 授权失败，请检查服务端配置")
	default:
		return httputil.ServiceUnavailable(fmt.Sprintf("Mapillary 服务暂不可用（HTTP %d）", status))
	}
}

func pickThumbURL(media *mediaRecord, width int) (string, error) {
	candidates := []struct {
		size int
		url  *string
	}{
		{256, media.Thumb256URL},
		{1024, media.Thumb1024URL},
		{2048, media.Thumb2048URL},
	}
	var chosen *string
	for _, candidate := range candidates {
		if candidate.url != nil {
			if candidate.size >= width {
				chosen = candidate.url
				break
			}
			chosen = candidate.url
		}
	}
	if chosen == nil {
		return "", httputil.ServiceUnavailable("Mapillary 图片缺少缩略图字段")
	}
	return *chosen, nil
}

// normalizeWidth snaps to the nearest supported thumbnail tier.
func normalizeWidth(width int) int {
	switch {
	case width <= 256:
		return allowedWidths
	case width <= 1024:
		return 1024
	default:
		return largestWidth
	}
}

// assertSafeImageURL blocks SSRF targets while keeping CDN flexibility.
func assertSafeImageURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return httputil.ServiceUnavailable("图源返回了非法图片地址")
	}
	if parsed.Scheme != "https" {
		return httputil.ServiceUnavailable("图源图片地址必须使用 HTTPS")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" || host == "localhost" || host == "0.0.0.0" || host == "127.0.0.1" || host == "::1" {
		return httputil.ServiceUnavailable("图源图片地址指向了受保护地址")
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
			ip.IsUnspecified() || ip.IsMulticast() {
			return httputil.ServiceUnavailable("图源图片地址指向了内网地址")
		}
		// CGNAT 100.64.0.0/10 and the 0.0.0.0/8 legacy range.
		if ip.To4() != nil {
			octets := ip.To4()
			if octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127 {
				return httputil.ServiceUnavailable("图源图片地址指向了内网地址")
			}
			if octets[0] == 0 || octets[0] == 169 && octets[1] == 254 {
				return httputil.ServiceUnavailable("图源图片地址指向了内网地址")
			}
		}
	}
	return nil
}

func (s *Service) fetchImage(rawURL string) ([]byte, error) {
	if err := assertSafeImageURL(rawURL); err != nil {
		return nil, err
	}
	if s.imageFetcher != nil {
		return s.imageFetcher(rawURL)
	}
	return s.fetchImageBuffer(rawURL)
}

func (s *Service) fetchImageBuffer(rawURL string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 图片加载失败")
	}
	req.Header.Set("User-Agent", "mma-guessr-backend")
	response, err := s.client.Do(req)
	if err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 图片加载超时")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, httputil.ServiceUnavailable(fmt.Sprintf("Mapillary 图片加载失败（HTTP %d）", response.StatusCode))
	}
	buffer, err := io.ReadAll(io.LimitReader(response.Body, maxImageBytes+1))
	if err != nil {
		return nil, httputil.ServiceUnavailable("Mapillary 图片加载失败")
	}
	if len(buffer) > maxImageBytes {
		return nil, httputil.ServiceUnavailable("Mapillary 图片超过大小限制")
	}
	return buffer, nil
}
