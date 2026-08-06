import { Router } from 'express';
import { z } from 'zod';

import { APP_CONSTANTS } from '../config/env.js';
import { BBOX_PATTERN, fetchMapillaryImage, searchMapillaryImages } from '../services/mapillary.js';
import { badRequest } from '../utils/httpError.js';
import { slidingWindowRateLimit } from '../utils/slidingWindowRateLimit.js';
import { parseQuery } from '../utils/validate.js';

const IMAGE_ID_PATTERN = /^[0-9A-Za-z_-]+$/;

const searchQuerySchema = z.object({
    bbox: z.string().regex(BBOX_PATTERN, 'bbox 格式应为 minLng,minLat,maxLng,maxLat'),
    limit: z.coerce.number().int().min(1).max(APP_CONSTANTS.MAPILLARY_MAX_SEARCH_LIMIT).default(20),
});

const imageQuerySchema = z.object({
    width: z.coerce
        .number()
        .int()
        .min(1)
        .max(APP_CONSTANTS.MAPILLARY_MAX_IMAGE_WIDTH)
        .default(APP_CONSTANTS.MAPILLARY_DEFAULT_IMAGE_WIDTH),
});

export const proxyRouter = Router();

// 服务端携带 MAPILLARY_TOKEN 请求 Mapillary，密钥永不下发前端；结果按 bbox+limit 缓存
proxyRouter.get(
    '/mapillary/search',
    slidingWindowRateLimit({
        keyPrefix: 'rl:mapillary-search:',
        windowMs: APP_CONSTANTS.MAPILLARY_RATE_WINDOW_MS,
        maxRequests: APP_CONSTANTS.MAPILLARY_RATE_SEARCH_MAX,
    }),
    async (req, res) => {
        const { bbox, limit } = parseQuery(searchQuerySchema, req.query);
        const result = await searchMapillaryImages(bbox, limit);
        res.json(result);
    }
);

proxyRouter.get(
    '/mapillary/image/:imageId',
    slidingWindowRateLimit({
        windowMs: APP_CONSTANTS.MAPILLARY_RATE_WINDOW_MS,
        maxRequests: APP_CONSTANTS.MAPILLARY_RATE_IMAGE_MAX,
        keyPrefix: 'rl:mapillary-image:',
    }),
    async (req, res) => {
        const rawImageId = req.params.imageId;
        const imageId = typeof rawImageId === 'string' ? rawImageId : undefined;
        if (imageId === undefined || !IMAGE_ID_PATTERN.test(imageId)) {
            throw badRequest('imageId 不合法');
        }
        const { width } = parseQuery(imageQuerySchema, req.query);
        const { buffer, contentType } = await fetchMapillaryImage(imageId, width);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', `public, max-age=${APP_CONSTANTS.MAPILLARY_IMAGE_TTL_SECONDS}`);
        res.send(buffer);
    }
);
