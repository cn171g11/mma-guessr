export const LOCATION_REGIONS = ['asia', 'europe', 'northamerica', 'southamerica', 'africa', 'oceania'] as const;

export type LocationRegion = (typeof LOCATION_REGIONS)[number];

// 位置图片数据源：当前仅 mapillary，后续接入新图源时在此登记并实现对应 provider
export const LOCATION_SOURCES = ['mapillary'] as const;

export type LocationSource = (typeof LOCATION_SOURCES)[number];

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
    source: LocationSource;
}

export interface LocationStats {
    total: number;
    byRegion: Record<LocationRegion, number>;
}
