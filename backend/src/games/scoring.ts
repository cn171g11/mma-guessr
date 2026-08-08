import type { LocationRegion } from '../locations/types.js';
import type { GameMode } from './types.js';

// 服务端权威计分，与前端 config.js 的 SCORE_CONFIG 保持一致：
// score = MAX_SCORE × e^(-10 × max(d, dMin/1000) / (D × α))，取整后截断到 [0, MAX_SCORE]
export const MAX_SCORE = 5000;

interface ScoreConfig {
    referenceSpanKm: number;
    balanceFactor: number;
    minDistanceKm: number;
}

const GLOBAL_CONFIG: ScoreConfig = { referenceSpanKm: 2000, balanceFactor: 2.3, minDistanceKm: 30 / 1000 };
const CHINA_CONFIG: ScoreConfig = { referenceSpanKm: 2000, balanceFactor: 1.8, minDistanceKm: 15 / 1000 };

const REGION_CONFIGS: Record<LocationRegion, ScoreConfig> = {
    asia: { referenceSpanKm: 1200, balanceFactor: 2.0, minDistanceKm: 25 / 1000 },
    europe: { referenceSpanKm: 1200, balanceFactor: 2.0, minDistanceKm: 20 / 1000 },
    northamerica: { referenceSpanKm: 1200, balanceFactor: 2.2, minDistanceKm: 30 / 1000 },
    southamerica: { referenceSpanKm: 1200, balanceFactor: 2.3, minDistanceKm: 35 / 1000 },
    africa: { referenceSpanKm: 1200, balanceFactor: 2.4, minDistanceKm: 40 / 1000 },
    oceania: { referenceSpanKm: 1200, balanceFactor: 2.5, minDistanceKm: 25 / 1000 },
};

function scoreConfigFor(mode: GameMode, region: string | null): ScoreConfig {
    if (mode === 'china') {
        return CHINA_CONFIG;
    }
    if (mode === 'region' && region !== null && region in REGION_CONFIGS) {
        return REGION_CONFIGS[region as LocationRegion];
    }
    return GLOBAL_CONFIG;
}

export function computeRoundScore(mode: GameMode, region: string | null, distanceKm: number): number {
    const config = scoreConfigFor(mode, region);
    const effectiveDistance = Math.max(distanceKm, config.minDistanceKm);
    const effectiveSpan = config.referenceSpanKm * config.balanceFactor;
    const score = Math.round(MAX_SCORE * Math.exp((-10 * effectiveDistance) / effectiveSpan));
    return Math.max(0, Math.min(MAX_SCORE, score));
}

// 与 Leaflet L.latLng.distanceTo 相同的大圆距离公式（地球半径 6378137m），
// 保证服务端按提交坐标重算的距离与前端展示的距离一致
const EARTH_RADIUS_KM = 6378.137;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function haversineKm(latA: number, lngA: number, latB: number, lngB: number): number {
    const latARad = latA * DEGREES_TO_RADIANS;
    const latBRad = latB * DEGREES_TO_RADIANS;
    const dLat = (latB - latA) * DEGREES_TO_RADIANS;
    const dLng = (lngB - lngA) * DEGREES_TO_RADIANS;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const a = sinLat * sinLat + Math.cos(latARad) * Math.cos(latBRad) * sinLng * sinLng;
    // 浮点误差可能使 a 略超 [0,1]，对跖点附近 sqrt(1 - a) 将产生 NaN，需收敛到有效区间
    const clamped = Math.max(0, Math.min(1, a));
    const c = 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
    return EARTH_RADIUS_KM * c;
}
