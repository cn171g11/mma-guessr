import type { QueryResultRow } from 'pg';

import { pool } from '../db/pool.js';
import type { LocationRecord, LocationRegion, LocationSource } from './types.js';

interface LocationRow extends QueryResultRow {
    id: string;
    name: string;
    mapillary_id: string | null;
    lat: number;
    lng: number;
    country: string | null;
    city: string | null;
    region: string;
    difficulty: number;
    panorama_url: string | null;
    source: string;
}

function mapRow(row: LocationRow): LocationRecord {
    return {
        id: Number(row.id),
        name: row.name,
        mapillaryId: row.mapillary_id,
        lat: Number(row.lat),
        lng: Number(row.lng),
        country: row.country,
        city: row.city,
        region: row.region as LocationRegion,
        difficulty: Number(row.difficulty),
        panoramaUrl: row.panorama_url,
        source: row.source as LocationSource,
    };
}

function buildFilters(
    region?: LocationRegion,
    difficulty?: number,
    source?: LocationSource
): { whereClause: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (region !== undefined) {
        params.push(region);
        conditions.push(`region = $${params.length}`);
    }
    if (difficulty !== undefined) {
        params.push(difficulty);
        conditions.push(`difficulty = $${params.length}`);
    }
    if (source !== undefined) {
        params.push(source);
        conditions.push(`source = $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params };
}

export async function fetchPoolIds(
    region?: LocationRegion,
    difficulty?: number,
    source?: LocationSource
): Promise<string[]> {
    const { whereClause, params } = buildFilters(region, difficulty, source);
    const result = await pool.query<{ id: string }>(`SELECT id FROM locations ${whereClause}`, params);
    return result.rows.map((row) => row.id);
}

export async function fetchByIds(ids: number[]): Promise<LocationRecord[]> {
    if (ids.length === 0) {
        return [];
    }
    const result = await pool.query<LocationRow>('SELECT * FROM locations WHERE id = ANY($1::bigint[])', [ids]);
    return result.rows.map(mapRow);
}

export async function fetchRegionCounts(): Promise<Array<{ region: LocationRegion; count: number }>> {
    const result = await pool.query<{ region: string; count: string }>(
        'SELECT region, COUNT(*)::int AS count FROM locations GROUP BY region'
    );
    return result.rows.map((row) => ({ region: row.region as LocationRegion, count: Number(row.count) }));
}
