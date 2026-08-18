package server

import (
	"net/http"
	"strconv"

	"mma-guessr/backend/internal/httputil"
	"mma-guessr/backend/internal/middleware"
	"mma-guessr/backend/internal/packs"
)

type packCreateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsPublic    bool   `json:"isPublic"`
}

type packUpdateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsPublic    *bool  `json:"isPublic"`
}

type packLocationsRequest struct {
	Locations []packs.LocationInput `json:"locations"`
}

func (s *Server) requesterOf(r *http.Request) packs.PlayerRef {
	identity, _ := middleware.IdentityFrom(r.Context())
	return packs.PlayerRef{Role: identity.Role, ID: identity.Subject}
}

// handlePacksList returns public packs, or the caller's own packs with mine=1.
func (s *Server) handlePacksList(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			httputil.WriteError(w, http.StatusBadRequest, "limit 需为 1-50 的整数")
			return
		}
		limit = parsed
	}
	mine := r.URL.Query().Get("mine") == "1"
	items, err := s.services.Packs.ListPacks(s.requesterOf(r), r.URL.Query().Get("q"), mine, limit)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if items == nil {
		items = []packs.Pack{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"packs": items})
}

// handlePacksCreate creates a pack owned by the caller (registered users only).
func (s *Server) handlePacksCreate(w http.ResponseWriter, r *http.Request) {
	requester := s.requesterOf(r)
	if requester.Role != "user" {
		httputil.WriteError(w, http.StatusForbidden, "仅注册用户可创建图包")
		return
	}
	var req packCreateRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	pack, err := s.services.Packs.CreatePack(requester.ID, req.Name, req.Description, req.IsPublic)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]any{"pack": pack})
}

// handlePacksGet returns one pack's metadata.
func (s *Server) handlePacksGet(w http.ResponseWriter, r *http.Request) {
	packID, ok := packIDOf(w, r)
	if !ok {
		return
	}
	pack, err := s.services.Packs.GetPack(packID)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"pack": pack})
}

// handlePacksUpdate patches a pack (owner only).
func (s *Server) handlePacksUpdate(w http.ResponseWriter, r *http.Request) {
	packID, ok := packIDOf(w, r)
	if !ok {
		return
	}
	var req packUpdateRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	pack, err := s.services.Packs.UpdatePack(s.requesterOf(r), packID, req.Name, req.Description, req.IsPublic)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"pack": pack})
}

// handlePacksDelete removes a pack (owner only).
func (s *Server) handlePacksDelete(w http.ResponseWriter, r *http.Request) {
	packID, ok := packIDOf(w, r)
	if !ok {
		return
	}
	if err := s.services.Packs.DeletePack(s.requesterOf(r), packID); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handlePacksLocationsList returns a pack's locations with geometry.
func (s *Server) handlePacksLocationsList(w http.ResponseWriter, r *http.Request) {
	packID, ok := packIDOf(w, r)
	if !ok {
		return
	}
	locations, err := s.services.Packs.ListLocations(s.requesterOf(r), packID)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	if locations == nil {
		locations = []packs.Location{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"locations": locations})
}

// handlePacksLocationsReplace atomically replaces a pack's locations (owner only).
func (s *Server) handlePacksLocationsReplace(w http.ResponseWriter, r *http.Request) {
	packID, ok := packIDOf(w, r)
	if !ok {
		return
	}
	var req packLocationsRequest
	if err := httputil.DecodeJSON(w, r, &req); err != nil {
		return
	}
	if err := s.services.Packs.ReplaceLocations(s.requesterOf(r), packID, req.Locations); err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handlePacksPlay returns the playable (coordinate-free) locations and bumps
// the pack's play counter.
func (s *Server) handlePacksPlay(w http.ResponseWriter, r *http.Request) {
	packID, ok := packIDOf(w, r)
	if !ok {
		return
	}
	pack, locations, err := s.services.Packs.GetPlayablePack(s.requesterOf(r), packID)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"pack":      map[string]any{"id": pack.ID, "name": pack.Name, "description": pack.Description, "ownerUsername": pack.OwnerUsername},
		"locations": locations,
	})
}

func packIDOf(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := r.PathValue("packId")
	packID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || packID < 1 {
		httputil.WriteError(w, http.StatusBadRequest, "packId 需为正整数")
		return 0, false
	}
	return packID, true
}