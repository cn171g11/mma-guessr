package packs

import (
	"testing"
	"time"

	"mma-guessr/backend/internal/db"
)

func newPacksService(t *testing.T) *Service {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.Migrate(conn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	if _, err := conn.Exec(
		`INSERT INTO users (id, username, email_hash, password_hash, created_at, updated_at)
		 VALUES ('u1', 'alice', 'h1', 'h', ?, ?)`, now, now); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := conn.Exec(
		`INSERT INTO users (id, username, email_hash, password_hash, created_at, updated_at)
		 VALUES ('u2', 'bob', 'h2', 'h', ?, ?)`, now, now); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return NewService(NewStore(conn))
}

func owner() PlayerRef { return PlayerRef{Role: "user", ID: "u1"} }

func stranger() PlayerRef { return PlayerRef{Role: "user", ID: "u2"} }

func TestCreatePackValidation(t *testing.T) {
	svc := newPacksService(t)

	if _, err := svc.CreatePack("u1", "", "desc", true); err == nil {
		t.Fatal("expected error for empty name")
	}
	long := ""
	for i := 0; i < 61; i++ {
		long += "a"
	}
	if _, err := svc.CreatePack("u1", long, "desc", true); err == nil {
		t.Fatal("expected error for overlong name")
	}
	desc := ""
	for i := 0; i < 501; i++ {
		desc += "a"
	}
	if _, err := svc.CreatePack("u1", "ok", desc, true); err == nil {
		t.Fatal("expected error for overlong description")
	}
}

func TestPackAccessControl(t *testing.T) {
	svc := newPacksService(t)

	privatePack, err := svc.CreatePack("u1", "私密", "", false)
	if err != nil {
		t.Fatal(err)
	}
	publicPack, err := svc.CreatePack("u1", "公开", "", true)
	if err != nil {
		t.Fatal(err)
	}
	seed := []LocationInput{{Name: "地点", Lat: 30, Lng: 100, Difficulty: 1, Region: "asia"}}
	if err := svc.ReplaceLocations(owner(), privatePack.ID, seed); err != nil {
		t.Fatal(err)
	}
	if err := svc.ReplaceLocations(owner(), publicPack.ID, seed); err != nil {
		t.Fatal(err)
	}

	// Owner can always view.
	if _, _, err := svc.GetPlayablePack(owner(), privatePack.ID); err != nil {
		t.Fatalf("owner should play own private pack: %v", err)
	}
	// Stranger cannot play a private pack.
	if _, _, err := svc.GetPlayablePack(stranger(), privatePack.ID); err == nil {
		t.Fatal("stranger must not play a private pack")
	}
	// Stranger can play a public pack.
	if _, _, err := svc.GetPlayablePack(stranger(), publicPack.ID); err != nil {
		t.Fatalf("stranger should play a public pack: %v", err)
	}

	// Stranger cannot edit a private or public pack.
	if _, err := svc.UpdatePack(stranger(), publicPack.ID, "改名", "", nil); err == nil {
		t.Fatal("stranger must not update a pack")
	}
	// Owner can edit.
	if _, err := svc.UpdatePack(owner(), publicPack.ID, "改名", "", nil); err != nil {
		t.Fatalf("owner should update own pack: %v", err)
	}
}

func TestReplaceLocations(t *testing.T) {
	svc := newPacksService(t)

	pack, err := svc.CreatePack("u1", "图包", "", true)
	if err != nil {
		t.Fatal(err)
	}

	valid := LocationInput{Name: "地点", Lat: 30, Lng: 100, Difficulty: 2, Region: "asia", ImageID: strPtr("img-abc")}
	tooMany := make([]LocationInput, MaxLocationsPerPack+1)
	for i := range tooMany {
		tooMany[i] = valid
	}
	if err := svc.ReplaceLocations(owner(), pack.ID, tooMany); err == nil {
		t.Fatal("expected error for too many locations")
	}

	if err := svc.ReplaceLocations(stranger(), pack.ID, []LocationInput{valid}); err == nil {
		t.Fatal("stranger must not replace locations")
	}

	if err := svc.ReplaceLocations(owner(), pack.ID, []LocationInput{valid}); err != nil {
		t.Fatalf("replace locations: %v", err)
	}

	locations, err := svc.ListLocations(owner(), pack.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(locations) != 1 {
		t.Fatalf("expected 1 location, got %d", len(locations))
	}
	if locations[0].Lat != 30 || locations[0].Lng != 100 {
		t.Fatalf("unexpected geometry %v", locations[0])
	}

	// Invalid inputs are rejected before touching the DB.
	bad := LocationInput{Name: "坏地点", Lat: 999, Lng: 0, Difficulty: 1, Region: "asia"}
	if err := svc.ReplaceLocations(owner(), pack.ID, []LocationInput{bad}); err == nil {
		t.Fatal("expected error for out-of-range lat")
	}
}

func TestPlayableLocationsHideGeometry(t *testing.T) {
	svc := newPacksService(t)

	pack, err := svc.CreatePack("u1", "游玩", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ReplaceLocations(owner(), pack.ID, []LocationInput{
		{Name: "地点", Lat: 30, Lng: 100, Difficulty: 2, Region: "asia", ImageID: strPtr("img-xyz")},
	}); err != nil {
		t.Fatal(err)
	}

	_, playable, err := svc.GetPlayablePack(stranger(), pack.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(playable) != 1 {
		t.Fatalf("expected 1 playable location, got %d", len(playable))
	}
	if playable[0].MapillaryID == nil || *playable[0].MapillaryID != "img-xyz" {
		t.Fatalf("mapillary id not exposed: %v", playable[0])
	}
}

func TestFetchPackLocationsForSettlement(t *testing.T) {
	svc := newPacksService(t)

	pack, err := svc.CreatePack("u1", "结算", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ReplaceLocations(owner(), pack.ID, []LocationInput{
		{Name: "地点", Lat: 30, Lng: 100, Difficulty: 2, Region: "asia"},
	}); err != nil {
		t.Fatal(err)
	}

	// Stranger cannot fetch geometry of a private pack.
	if _, err := svc.FetchPackLocations(pack.ID, stranger()); err == nil {
		t.Fatal("stranger must not fetch private pack geometry")
	}
	// Owner can.
	locations, err := svc.FetchPackLocations(pack.ID, owner())
	if err != nil {
		t.Fatal(err)
	}
	if len(locations) != 1 || locations[0].Lat != 30 {
		t.Fatalf("unexpected settlement data %v", locations)
	}
}

func strPtr(value string) *string {
	return &value
}