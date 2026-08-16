package e2e

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newProxyEnv starts a stub Mapillary upstream and wires it into the server.
func newProxyEnv(t *testing.T) (*testEnv, *httptest.Server) {
	t.Helper()
	env := newTestEnv(t)
	env.mapillary.SetToken("test-token")
	// The SSRF guard blocks the stub's 127.0.0.1 host for real fetches, so
	// the byte download is injected here (the guard still runs first).
	env.mapillary.SetImageFetcher(func(_ string) ([]byte, error) {
		return []byte("fake-jpeg-bytes"), nil
	})

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/images"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"id": "img_1", "geometry": map[string]any{"type": "Point", "coordinates": []float64{104.1, 30.6}}, "is_pano": true},
				},
			})
		case strings.HasPrefix(r.URL.Path, "/media_1"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"thumb_256_url":  "https://cdn.example.com/img_1_256.jpg",
				"thumb_1024_url": "https://cdn.example.com/img_1_1024.jpg",
				"thumb_2048_url": "https://cdn.example.com/img_1_2048.jpg",
			})
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	t.Cleanup(upstream.Close)
	env.mapillary.SetUpstream(upstream.URL, upstream.Client())

	return env, upstream
}

func TestMapillaryProxy(t *testing.T) {
	e, _ := newProxyEnv(t)

	t.Run("search proxies and caches upstream data", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/mapillary/search?bbox=104,30,105,31&limit=10", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d: %v", resp.status, resp.body)
		}
		data := resp.nestedArray("data")
		if len(data) != 1 {
			t.Fatalf("expected 1 image, got %d", len(data))
		}
		image := data[0].(map[string]any)
		if image["id"] != "img_1" {
			t.Fatalf("unexpected image %v", image)
		}
	})

	t.Run("invalid bbox rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/mapillary/search?bbox=abc&limit=10", "", nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("image proxy returns bytes with cache headers", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, e.ts.URL+"/api/proxy/mapillary/image/media_1?width=1024", nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("image request failed: %v", err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", res.StatusCode)
		}
		if res.Header.Get("Content-Type") != "image/jpeg" {
			t.Fatalf("unexpected content type %s", res.Header.Get("Content-Type"))
		}
		if !strings.Contains(res.Header.Get("Cache-Control"), "max-age=86400") {
			t.Fatalf("unexpected cache-control %s", res.Header.Get("Cache-Control"))
		}
		// The stub upstream returns HTML, but the proxy should pass bytes through.
		body, _ := io.ReadAll(res.Body)
		if len(body) == 0 {
			t.Fatal("expected non-empty body")
		}
	})

	t.Run("invalid image id rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/mapillary/image/bad!id", "", nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("width bounds enforced", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/mapillary/image/media_1?width=99999", "", nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("unknown imagery source rejected", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/imagery/other/search?bbox=104,30,105,31", "", nil)
		if resp.status != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", resp.status)
		}
	})

	t.Run("imagery mapillary source works", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/imagery/mapillary/search?bbox=104,30,105,31&limit=5", "", nil)
		if resp.status != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.status)
		}
	})
}

func TestMapillaryNoToken(t *testing.T) {
	e := newTestEnv(t)

	t.Run("search without token returns 503", func(t *testing.T) {
		resp := e.request(t, http.MethodGet, "/api/proxy/mapillary/search?bbox=104,30,105,31", "", nil)
		if resp.status != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", resp.status)
		}
	})
}

func TestMapillarySSRFGuard(t *testing.T) {
	e := newTestEnv(t)
	e.mapillary.SetToken("test-token")

	// Upstream returns a media record whose thumbnail points at a protected
	// address; the proxy must refuse to fetch it.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"thumb_256_url":  "https://127.0.0.1/x.jpg",
			"thumb_1024_url": "https://127.0.0.1/x.jpg",
			"thumb_2048_url": "https://127.0.0.1/x.jpg",
		})
	}))
	t.Cleanup(upstream.Close)
	e.mapillary.SetUpstream(upstream.URL, upstream.Client())

	resp := e.request(t, http.MethodGet, "/api/proxy/mapillary/image/media_1?width=1024", "", nil)
	if resp.status != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %v", resp.status, resp.body)
	}
	if !strings.Contains(resp.str("error"), "受保护") {
		t.Fatalf("expected protected-address error, got %v", resp.body)
	}
}
