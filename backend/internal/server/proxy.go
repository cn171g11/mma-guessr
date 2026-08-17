package server

import (
	"net/http"
	"regexp"
	"strconv"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/mapillary"
)

var proxyImageIDPattern = regexp.MustCompile(`^[0-9A-Za-z_-]+$`)

// handleMapillarySearch proxies the Mapillary image search.
func (s *Server) handleMapillarySearch(w http.ResponseWriter, r *http.Request) {
	bbox := r.URL.Query().Get("bbox")
	if !mapillary.IsValidBBox(bbox) {
		httputil.WriteError(w, http.StatusBadRequest, "bbox 格式应为 minLng,minLat,maxLng,maxLat")
		return
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			httputil.WriteError(w, http.StatusBadRequest, "limit 需为 1-50 的整数")
			return
		}
		limit = parsed
	}
	result, err := s.services.Mapillary.SearchImages(bbox, limit)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

// handleMapillaryImage proxies a thumbnail image (cached bytes).
func (s *Server) handleMapillaryImage(w http.ResponseWriter, r *http.Request) {
	imageID := r.PathValue("imageId")
	if !proxyImageIDPattern.MatchString(imageID) {
		httputil.WriteError(w, http.StatusBadRequest, "imageId 不合法")
		return
	}
	width := 1024
	if raw := r.URL.Query().Get("width"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 2048 {
			httputil.WriteError(w, http.StatusBadRequest, "width 需为 1-2048 的整数")
			return
		}
		width = parsed
	}
	s.serveImage(w, r, imageID, width)
}

// handleMapillaryMedia resolves a Mapillary image to its public CDN thumbnail
// URL so the browser can fetch the bytes directly from the CDN, keeping the
// token server-side and sparing the backend's bandwidth and cache storage.
func (s *Server) handleMapillaryMedia(w http.ResponseWriter, r *http.Request) {
	imageID := r.PathValue("imageId")
	if !proxyImageIDPattern.MatchString(imageID) {
		httputil.WriteError(w, http.StatusBadRequest, "imageId 不合法")
		return
	}
	width := 1024
	if raw := r.URL.Query().Get("width"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 2048 {
			httputil.WriteError(w, http.StatusBadRequest, "width 需为 1-2048 的整数")
			return
		}
		width = parsed
	}
	url, err := s.services.Mapillary.ResolveMediaURL(imageID, width)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"url": url})
}

// handleImagerySearch routes to the source provider's search.
func (s *Server) handleImagerySearch(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	if source != "mapillary" {
		httputil.WriteError(w, http.StatusBadRequest, "未知图片数据源："+source)
		return
	}
	s.handleMapillarySearch(w, r)
}

// handleImageryImage routes to the source provider's image fetch.
func (s *Server) handleImageryImage(w http.ResponseWriter, r *http.Request) {
	source := r.PathValue("source")
	if source != "mapillary" {
		httputil.WriteError(w, http.StatusBadRequest, "未知图片数据源："+source)
		return
	}
	s.handleMapillaryImage(w, r)
}

func (s *Server) serveImage(w http.ResponseWriter, r *http.Request, imageID string, width int) {
	fetched, err := s.services.Mapillary.FetchImage(imageID, width)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", fetched.ContentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(fetched.Buffer) // #nosec G705 -- ContentType is a fixed image/jpeg constant, never user input
}
