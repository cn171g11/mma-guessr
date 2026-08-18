package packs

import (
	"errors"
	"regexp"

	"mma-guessr/backend/internal/httputil"
)

const (
	// MaxPackName caps the pack display name length.
	MaxPackName = 60
	// MaxPackDescription caps the pack description length.
	MaxPackDescription = 500
	// MaxLocationsPerPack caps how many locations a pack may hold.
	MaxLocationsPerPack = 50
	// MaxLocationName caps a single pack location name length.
	MaxLocationName = 120
)

var imageIDPattern = regexp.MustCompile(`^[0-9A-Za-z_-]{1,64}$`)

// Service manages pack business rules and validation.
type Service struct {
	store *Store
}

// NewService creates a packs Service.
func NewService(store *Store) *Service {
	return &Service{store: store}
}

// CreatePack creates a pack after validating its metadata.
func (s *Service) CreatePack(ownerID, name, description string, isPublic bool) (*Pack, error) {
	if err := validateMetadata(name, description); err != nil {
		return nil, err
	}
	return s.store.CreatePack(ownerID, name, description, isPublic)
}

// ListPacks lists packs for the requester. mine scopes the result to the
// requester's own packs; otherwise public packs are shown.
func (s *Service) ListPacks(requester PlayerRef, search string, mine bool, limit int) ([]Pack, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	query := ListQuery{Search: search, Limit: limit}
	if mine {
		if requester.Role != "user" {
			return []Pack{}, nil
		}
		query.OwnerID = requester.ID
	}
	return s.store.ListPacks(query)
}

// GetPack returns one pack's metadata (public or owned).
func (s *Service) GetPack(id int64) (*Pack, error) {
	pack, err := s.store.GetPack(id)
	if err != nil {
		return nil, err
	}
	if pack == nil {
		return nil, httputil.NotFound("图包不存在")
	}
	return pack, nil
}

// UpdatePack patches a pack owned by the requester. Empty strings keep the
// current values so the handler can send only the fields being changed.
func (s *Service) UpdatePack(requester PlayerRef, id int64, name, description string, isPublic *bool) (*Pack, error) {
	if requester.Role != "user" {
		return nil, httputil.Forbidden("仅注册用户可管理图包")
	}
	current, err := s.GetPack(id)
	if err != nil {
		return nil, err
	}
	if current.OwnerID != requester.ID {
		return nil, httputil.Forbidden("无权修改该图包")
	}
	if name == "" {
		name = current.Name
	}
	if description == "" {
		description = current.Description
	}
	public := current.IsPublic
	if isPublic != nil {
		public = *isPublic
	}
	if err := validateMetadata(name, description); err != nil {
		return nil, err
	}
	if err := s.store.UpdatePack(id, requester.ID, name, description, public); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, httputil.NotFound("图包不存在")
		}
		return nil, err
	}
	return s.GetPack(id)
}

// DeletePack removes a pack owned by the requester.
func (s *Service) DeletePack(requester PlayerRef, id int64) error {
	if requester.Role != "user" {
		return httputil.Forbidden("仅注册用户可管理图包")
	}
	if err := s.store.DeletePack(id, requester.ID); err != nil {
		if errors.Is(err, errNotFound) {
			return httputil.NotFound("图包不存在")
		}
		return err
	}
	return nil
}

// ListLocations returns a pack's locations with geometry (public or owned).
func (s *Service) ListLocations(requester PlayerRef, id int64) ([]Location, error) {
	pack, err := s.GetPack(id)
	if err != nil {
		return nil, err
	}
	if !canViewPack(pack, requester) {
		return nil, httputil.Forbidden("无权查看该图包")
	}
	return s.store.ListLocations(id)
}

// ReplaceLocations atomically replaces a pack's locations (owner only).
func (s *Service) ReplaceLocations(requester PlayerRef, id int64, inputs []LocationInput) error {
	if requester.Role != "user" {
		return httputil.Forbidden("仅注册用户可管理图包")
	}
	pack, err := s.GetPack(id)
	if err != nil {
		return err
	}
	if pack.OwnerID != requester.ID {
		return httputil.Forbidden("无权修改该图包")
	}
	if len(inputs) > MaxLocationsPerPack {
		return httputil.BadRequest("图包最多包含 50 个地点")
	}
	if err := validateLocationInputs(inputs); err != nil {
		return err
	}
	return s.store.ReplaceLocations(id, inputs)
}

// GetPlayablePack returns the pack (public or owned) with its playable
// locations and bumps the play counter. It is the authoritative source a
// player may use to start a pack game.
func (s *Service) GetPlayablePack(requester PlayerRef, id int64) (*Pack, []PublicLocation, error) {
	pack, err := s.GetPack(id)
	if err != nil {
		return nil, nil, err
	}
	if !canViewPack(pack, requester) {
		return nil, nil, httputil.Forbidden("无权游玩该图包")
	}
	locations, err := s.store.FetchPlayableLocations(id)
	if err != nil {
		return nil, nil, err
	}
	if len(locations) == 0 {
		return nil, nil, httputil.BadRequest("该图包暂无地点")
	}
	_ = s.store.IncrementPlayCount(id)
	return pack, locations, nil
}

// FetchPackLocations returns the full (geometry-bearing) locations of a pack
// for server-authoritative settlement. The pack must be public or owned.
func (s *Service) FetchPackLocations(packID int64, requester PlayerRef) ([]Location, error) {
	pack, err := s.GetPack(packID)
	if err != nil {
		return nil, err
	}
	if !canViewPack(pack, requester) {
		return nil, httputil.Forbidden("无权游玩该图包")
	}
	return s.store.ListLocations(packID)
}

// PlayerRef identifies the caller for access control.
type PlayerRef struct {
	Role string
	ID   string
}

func canViewPack(pack *Pack, requester PlayerRef) bool {
	if pack.IsPublic {
		return true
	}
	return requester.Role == "user" && pack.OwnerID == requester.ID
}

func validateMetadata(name, description string) error {
	if name == "" {
		return httputil.BadRequest("图包名称不能为空")
	}
	if len(name) > MaxPackName {
		return httputil.BadRequest("图包名称过长")
	}
	if len(description) > MaxPackDescription {
		return httputil.BadRequest("图包描述过长")
	}
	return nil
}

func validateLocationInputs(inputs []LocationInput) error {
	for _, input := range inputs {
		if err := validateLocationInput(input); err != nil {
			return err
		}
	}
	return nil
}

func validateLocationInput(input LocationInput) error {
	if input.Name == "" {
		return httputil.BadRequest("地点名称不能为空")
	}
	if len(input.Name) > MaxLocationName {
		return httputil.BadRequest("地点名称过长")
	}
	if input.Lat < -90 || input.Lat > 90 {
		return httputil.BadRequest("lat 超出范围")
	}
	if input.Lng < -180 || input.Lng > 180 {
		return httputil.BadRequest("lng 超出范围")
	}
	if input.Difficulty < 1 || input.Difficulty > 5 {
		return httputil.BadRequest("难度需在 1-5 之间")
	}
	if !contains(RegionValues, input.Region) {
		return httputil.BadRequest("无效的区域")
	}
	if input.ImageID != nil && !imageIDPattern.MatchString(*input.ImageID) {
		return httputil.BadRequest("imageId 包含非法字符")
	}
	return nil
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
