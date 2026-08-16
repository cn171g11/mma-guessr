package games

import "math"

// MaxRoundScore is the maximum score a single round can award.
const MaxRoundScore = 5000

// scoreConfig mirrors the previous frontend SCORE_CONFIG: each mode/region
// has an independent reference span and balance factor.
type scoreConfig struct {
	referenceSpanKm float64
	balanceFactor   float64
	minDistanceKm   float64
}

var globalConfig = scoreConfig{referenceSpanKm: 2000, balanceFactor: 2.3, minDistanceKm: 30.0 / 1000}
var chinaConfig = scoreConfig{referenceSpanKm: 2000, balanceFactor: 1.8, minDistanceKm: 15.0 / 1000}

var regionConfigs = map[string]scoreConfig{
	"asia":         {referenceSpanKm: 1200, balanceFactor: 2.0, minDistanceKm: 25.0 / 1000},
	"europe":       {referenceSpanKm: 1200, balanceFactor: 2.0, minDistanceKm: 20.0 / 1000},
	"northamerica": {referenceSpanKm: 1200, balanceFactor: 2.2, minDistanceKm: 30.0 / 1000},
	"southamerica": {referenceSpanKm: 1200, balanceFactor: 2.3, minDistanceKm: 35.0 / 1000},
	"africa":       {referenceSpanKm: 1200, balanceFactor: 2.4, minDistanceKm: 40.0 / 1000},
	"oceania":      {referenceSpanKm: 1200, balanceFactor: 2.5, minDistanceKm: 25.0 / 1000},
}

func scoreConfigFor(mode, region string) scoreConfig {
	if mode == "china" {
		return chinaConfig
	}
	if mode == "region" {
		if cfg, ok := regionConfigs[region]; ok {
			return cfg
		}
	}
	return globalConfig
}

// ComputeRoundScore is the server-authoritative per-round score:
// score = MAX_SCORE × e^(-10 × max(d, dMin) / (D × α)), rounded, clamped.
func ComputeRoundScore(mode, region string, distanceKm float64) int {
	config := scoreConfigFor(mode, region)
	effectiveDistance := math.Max(distanceKm, config.minDistanceKm)
	effectiveSpan := config.referenceSpanKm * config.balanceFactor
	score := math.Round(MaxRoundScore * math.Exp((-10*effectiveDistance)/effectiveSpan))
	return int(math.Max(0, math.Min(MaxRoundScore, score)))
}

// EarthRadiusKm matches Leaflet's L.latLng.distanceTo (WGS84 sphere).
const EarthRadiusKm = 6378.137

const degreesToRadians = math.Pi / 180

// HaversineKm returns the great-circle distance between two coordinates.
func HaversineKm(latA, lngA, latB, lngB float64) float64 {
	latARad := latA * degreesToRadians
	latBRad := latB * degreesToRadians
	dLat := (latB - latA) * degreesToRadians
	dLng := (lngB - lngA) * degreesToRadians
	sinLat := math.Sin(dLat / 2)
	sinLng := math.Sin(dLng / 2)
	a := sinLat*sinLat + math.Cos(latARad)*math.Cos(latBRad)*sinLng*sinLng
	// Float error can push a slightly outside [0,1]; clamp to keep sqrt sane.
	clamped := math.Max(0, math.Min(1, a))
	c := 2 * math.Atan2(math.Sqrt(clamped), math.Sqrt(1-clamped))
	return EarthRadiusKm * c
}
