package games

// GameModes are the supported single-player game modes, kept in the same
// order as the previous backend so validation errors stay identical.
var GameModes = []string{"classic", "challenge", "region", "china", "endless", "daily", "duel", "landmark"}

// PlayerRef identifies a guest or registered player.
type PlayerRef struct {
	Role string
	ID   string
}

// GameRound is the stored per-round record. Field order matches the previous
// JSON serialization byte-for-byte.
type GameRound struct {
	Name       string   `json:"name"`
	LocationID *int64   `json:"locationId"`
	DistanceKm *float64 `json:"distanceKm"`
	Score      int      `json:"score"`
	ImageID    *string  `json:"imageId"`
	Xp         int      `json:"xp"`
	Difficulty int      `json:"difficulty"`
	GuessLat   *float64 `json:"guessLat"`
	GuessLng   *float64 `json:"guessLng"`
	AnswerLat  *float64 `json:"answerLat"`
	AnswerLng  *float64 `json:"answerLng"`
}

// SubmitGameInput is the validated game submission payload.
type SubmitGameInput struct {
	Mode       string
	Region     *string
	TotalScore int
	Rounds     []GameRound
}

// GameRecord is a stored game result.
type GameRecord struct {
	ID         int64       `json:"id"`
	Mode       string      `json:"mode"`
	Region     *string     `json:"region"`
	TotalScore int         `json:"totalScore"`
	Rounds     []GameRound `json:"rounds"`
	CreatedAt  string      `json:"createdAt"`
}
