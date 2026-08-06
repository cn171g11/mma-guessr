export const LOCATION_REGIONS = ['asia', 'europe', 'northamerica', 'southamerica', 'africa', 'oceania'] as const;

export type LocationRegion = (typeof LOCATION_REGIONS)[number];

export interface LocationRecord {
    id: number;
    name: string;
    mapillaryId: string | null;
    lat: number;
    lng: number;
    country: string | null;
    city: string | null;
    region: LocationRegion;
    difficulty: number;
    panoramaUrl: string | null;
}

export interface LocationStats {
    total: number;
    byRegion: Record<LocationRegion, number>;
}
