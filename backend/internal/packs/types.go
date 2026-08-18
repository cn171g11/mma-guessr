package packs

// RegionValues are the region labels a pack location may carry. "world" marks
// a location without a specific continent so the UI can still show a hint.
var RegionValues = []string{"asia", "europe", "northamerica", "southamerica", "africa", "oceania", "world"}

// Pack is one user-created question pack.
type Pack struct {
	ID            int64  `json:"id"`
	OwnerID       string `json:"ownerId"`
	OwnerUsername string `json:"ownerUsername"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	IsPublic      bool   `json:"isPublic"`
	PlayCount     int    `json:"playCount"`
	LocationCount int    `json:"locationCount"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// Location is one full pack location record, including the answer geometry.
type Location struct {
	ID          int64   `json:"id"`
	PackID      int64   `json:"packId"`
	Name        string  `json:"name"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	Difficulty  int     `json:"difficulty"`
	Region      string  `json:"region"`
	ImageID     *string `json:"imageId"`
	PanoramaURL *string `json:"panoramaUrl"`
}

// PublicLocation is what a player may see before submitting: never the answer
// coordinates, mirroring the daily challenge contract.
type PublicLocation struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Difficulty  int     `json:"difficulty"`
	Region      string  `json:"region"`
	MapillaryID *string `json:"mapillaryId"`
	PanoramaURL *string `json:"panoramaUrl"`
}

// LocationInput is one location payload sent by a pack owner.
type LocationInput struct {
	Name        string  `json:"name"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	Difficulty  int     `json:"difficulty"`
	Region      string  `json:"region"`
	ImageID     *string `json:"imageId"`
	PanoramaURL *string `json:"panoramaUrl"`
}

// ListQuery filters the pack listing.
type ListQuery struct {
	OwnerID string
	Search  string
	Limit   int
}
