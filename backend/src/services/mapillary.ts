import { APP_CONSTANTS } from '../config/env.js';
import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import { serviceUnavailable, tooManyRequests } from '../utils/httpError.js';

const log = createLogger('mapillary');

const GRAPH_BASE_URL = 'https://graph.mapillary.com';
const MEDIA_FIELDS = 'thumb_256_url,thumb_1024_url,thumb_2048_url';
const IMAGE_SEARCH_FIELDS = 'id,geometry,is_pano';
const CACHE_CONTENT_TYPE = 'image/jpeg';

const SEARCH_CACHE_PREFIX = 'mly:search:';
const MEDIA_CACHE_PREFIX = 'mly:media:';
const IMAGE_CACHE_PREFIX = 'mly:img:';

// bbox 格式：minLng,minLat,maxLng,maxLat（十进制小数，允许负值）
export const BBOX_PATTERN = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

export interface MapillaryImage {
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    is_pano?: boolean;
}

export interface MapillarySearchResult {
    data: MapillaryImage[];
}

interface MediaRecord {
    thumb_256_url?: string;
    thumb_1024_url?: string;
    thumb_2048_url?: string;
}

// 请求时惰性读取密钥：便于测试注入，且服务启动后更新环境变量无需重启即可生效
function getMapillaryToken(): string {
    return process.env.MAPILLARY_TOKEN ?? '';
}

function assertTokenConfigured(): void {
    if (getMapillaryToken() === '') {
        throw serviceUnavailable('Mapillary 代理未配置（缺少 MAPILLARY_TOKEN）');
    }
}

function mapUpstreamError(status: number): Error {
    if (status === 429) {
        return tooManyRequests('Mapillary 请求超出额度，请稍后再试');
    }
    if (status === 401 || status === 403) {
        log.error(`Mapillary 授权失败（HTTP ${status}），请检查 MAPILLARY_TOKEN`);
        return serviceUnavailable('Mapillary 授权失败，请检查服务端配置');
    }
    return serviceUnavailable(`Mapillary 服务暂不可用（HTTP ${status}）`);
}

async function requestJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONSTANTS.MAPILLARY_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'mma-guessr-backend' },
        });
        if (!response.ok) {
            throw mapUpstreamError(response.status);
        }
        return (await response.json()) as unknown;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw serviceUnavailable('Mapillary 请求超时');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function searchMapillaryImages(bbox: string, limit: number): Promise<MapillarySearchResult> {
    assertTokenConfigured();
    const cacheKey = `${SEARCH_CACHE_PREFIX}${bbox}:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
        return JSON.parse(cached) as MapillarySearchResult;
    }

    const params = new URLSearchParams({
        access_token: getMapillaryToken(),
        fields: IMAGE_SEARCH_FIELDS,
        bbox,
        limit: String(limit),
    });
    const result = (await requestJson(`${GRAPH_BASE_URL}/images?${params.toString()}`)) as MapillarySearchResult;
    await redis.set(cacheKey, JSON.stringify(result), 'EX', APP_CONSTANTS.MAPILLARY_SEARCH_TTL_SECONDS);
    return result;
}

async function resolveMedia(imageId: string): Promise<MediaRecord> {
    const cacheKey = `${MEDIA_CACHE_PREFIX}${imageId}`;
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
        return JSON.parse(cached) as MediaRecord;
    }

    const params = new URLSearchParams({ access_token: getMapillaryToken(), fields: MEDIA_FIELDS });
    const media = (await requestJson(`${GRAPH_BASE_URL}/${imageId}?${params.toString()}`)) as MediaRecord;
    await redis.set(cacheKey, JSON.stringify(media), 'EX', APP_CONSTANTS.MAPILLARY_MEDIA_TTL_SECONDS);
    return media;
}

// 选择不小于请求宽度、最近的一档缩略图；没有则取最大一档
function pickThumbUrl(media: MediaRecord, width: number): string {
    const sizeCandidates = [
        { size: 256, url: media.thumb_256_url },
        { size: 1024, url: media.thumb_1024_url },
        { size: 2048, url: media.thumb_2048_url },
    ].filter((candidate): candidate is { size: number; url: string } => candidate.url !== undefined);

    const chosen =
        sizeCandidates.find((candidate) => candidate.size >= width) ?? sizeCandidates[sizeCandidates.length - 1];
    if (chosen === undefined) {
        throw serviceUnavailable('Mapillary 图片缺少缩略图字段');
    }
    return chosen.url;
}

// 上游返回的缩略图 URL 做基础 SSRF 防护：仅允许 HTTPS，并拒绝回环/内网/链路本地/云元数据地址。
// 不做严格域名白名单，避免 Mapillary CDN 域名变动导致街景加载被误伤；此处聚焦阻断 SSRF 高危目标。
function assertSafeImageUrl(rawUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw serviceUnavailable('图源返回了非法图片地址');
    }
    if (parsed.protocol !== 'https:') {
        throw serviceUnavailable('图源图片地址必须使用 HTTPS');
    }
    const host = parsed.hostname.toLowerCase();
    if (host === '' || host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '::1') {
        throw serviceUnavailable('图源图片地址指向了受保护地址');
    }
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4 !== null) {
        const a = Number(ipv4[1]);
        const b = Number(ipv4[2]);
        const isPrivate =
            a === 10 || // 10.0.0.0/8
            a === 0 || // 0.0.0.0/8
            a === 127 || // 127.0.0.0/8
            (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
            (a === 192 && b === 168) || // 192.168.0.0/16
            (a === 169 && b === 254) || // 169.254.0.0/16（链路本地 / 云元数据）
            (a === 100 && b >= 64 && b <= 127); // 100.64.0.0/10（CGNAT）
        if (isPrivate) {
            throw serviceUnavailable('图源图片地址指向了内网地址');
        }
    }
    // IPv6：拒绝回环/未指定/链路本地/唯一本地地址
    if (host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
        throw serviceUnavailable('图源图片地址指向了内网地址');
    }
    return parsed.toString();
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
    const safeUrl = assertSafeImageUrl(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONSTANTS.MAPILLARY_TIMEOUT_MS);
    try {
        const response = await fetch(safeUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'mma-guessr-backend' },
        });
        if (!response.ok) {
            throw serviceUnavailable(`Mapillary 图片加载失败（HTTP ${response.status}）`);
        }
        // 单次最大缓存上限同时作为硬性拉取上限：避免上游异常时流式灌入超大内存
        const reader = response.body?.getReader();
        if (reader === undefined) {
            throw serviceUnavailable('Mapillary 图片响应缺少内容体');
        }
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            totalBytes += value.byteLength;
            if (totalBytes > APP_CONSTANTS.MAPILLARY_MAX_IMAGE_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw serviceUnavailable('Mapillary 图片超过大小限制');
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks);
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw serviceUnavailable('Mapillary 图片加载超时');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

// 宽度归一化到三档（与上游缩略图档位一致）：防止任意 width 膨胀 Redis 缓存条目
const ALLOWED_WIDTHS = [256, 1024, 2048] as const;
// noUncheckedIndexedAccess 下元组索引含 undefined，兜底直接取最大档位字面量
const LARGEST_ALLOWED_WIDTH = 2048;
function normalizeWidth(width: number): number {
    for (const candidate of ALLOWED_WIDTHS) {
        if (candidate >= width) {
            return candidate;
        }
    }
    return LARGEST_ALLOWED_WIDTH;
}

export interface FetchedImage {
    buffer: Buffer;
    contentType: string;
}

export async function fetchMapillaryImage(imageId: string, width: number): Promise<FetchedImage> {
    assertTokenConfigured();
    const normalizedWidth = normalizeWidth(width);
    const media = await resolveMedia(imageId);
    const thumbUrl = pickThumbUrl(media, normalizedWidth);

    const cacheKey = `${IMAGE_CACHE_PREFIX}${imageId}:${normalizedWidth}`;
    const cached = await redis.getBuffer(cacheKey);
    if (cached !== null) {
        return { buffer: cached, contentType: CACHE_CONTENT_TYPE };
    }

    const buffer = await fetchImageBuffer(thumbUrl);
    if (buffer.length <= APP_CONSTANTS.MAPILLARY_MAX_IMAGE_BYTES) {
        await redis.set(cacheKey, buffer, 'EX', APP_CONSTANTS.MAPILLARY_IMAGE_TTL_SECONDS);
    }
    return { buffer, contentType: CACHE_CONTENT_TYPE };
}
