import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { redis } from '../src/db/redis.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { apiSignature } from '../src/middleware/apiSignature.js';
import { buildSignatureMessage } from '../src/utils/requestSignature.js';
import { resetAppRedis } from './helpers.js';

const TEST_SIGNING_SECRET = 'test-signing-secret-0123456789';

interface SigningHeaders {
    'x-request-timestamp': string;
    'x-request-nonce': string;
    'x-request-signature': string;
}

function buildSignedApp(): express.Express {
    const app = express();
    app.use(
        express.json({
            verify: (req, _res, buffer) => {
                (req as express.Request).rawBody = buffer.toString('utf8');
            },
        })
    );
    app.use(apiSignature);
    app.get('/echo', (_req, res) => res.json({ ok: true }));
    app.post('/echo', (_req, res) => res.json({ ok: true }));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
}

function computeSignature(secret: string, message: string): string {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function randomNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

function buildSigningHeaders(method: string, path: string, body: string, timestamp: string, nonce: string) {
    const message = buildSignatureMessage({ timestamp, nonce, method, path, body });
    const signature = computeSignature(TEST_SIGNING_SECRET, message);
    const headers: SigningHeaders = {
        'x-request-timestamp': timestamp,
        'x-request-nonce': nonce,
        'x-request-signature': signature,
    };
    return headers;
}

function freshSigningHeaders(method: string, path: string, body = ''): SigningHeaders {
    return buildSigningHeaders(method, path, body, String(Date.now()), randomNonce());
}

describe('apiSignature（请求签名 + 防重放）', () => {
    beforeEach(async () => {
        await resetAppRedis();
    });

    afterAll(async () => {
        await redis.quit();
    });

    it('未配置 API_SIGNING_SECRET 时完全放行', async () => {
        delete process.env.API_SIGNING_SECRET;
        const response = await request(buildSignedApp()).get('/echo');
        expect(response.status).toBe(200);
    });

    it('配置密钥后无签名请求被拒绝', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const response = await request(buildSignedApp()).get('/echo');
        expect(response.status).toBe(400);
    });

    it('GET 请求带合法签名通过', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const response = await request(buildSignedApp()).get('/echo').set(freshSigningHeaders('GET', '/echo'));
        expect(response.status).toBe(200);
    });

    it('POST 请求签名覆盖请求体原文', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const body = JSON.stringify({ answer: 42 });
        const response = await request(buildSignedApp())
            .post('/echo')
            .set('Content-Type', 'application/json')
            .set(freshSigningHeaders('POST', '/echo', body))
            .send(body);
        expect(response.status).toBe(200);
    });

    it('请求体被篡改时签名校验失败', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const signedBody = JSON.stringify({ answer: 42 });
        const tamperedBody = JSON.stringify({ answer: 43 });
        const response = await request(buildSignedApp())
            .post('/echo')
            .set('Content-Type', 'application/json')
            .set(freshSigningHeaders('POST', '/echo', signedBody))
            .send(tamperedBody);
        expect(response.status).toBe(400);
    });

    it('时间戳超出 ±5 分钟容忍窗口被拒绝', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const staleTimestamp = String(Date.now() - 6 * 60 * 1000);
        const response = await request(buildSignedApp())
            .get('/echo')
            .set(buildSigningHeaders('GET', '/echo', '', staleTimestamp, randomNonce()));
        expect(response.status).toBe(400);
    });

    it('同一 nonce 重用被拦截（防重放）', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const nonce = randomNonce();
        const headers = buildSigningHeaders('POST', '/echo', '', String(Date.now()), nonce);
        const app = buildSignedApp();
        const first = await request(app).post('/echo').set(headers);
        const replay = await request(app).post('/echo').set(headers);
        expect(first.status).toBe(200);
        expect(replay.status).toBe(400);
    });

    it('探活端点跳过签名校验', async () => {
        process.env.API_SIGNING_SECRET = TEST_SIGNING_SECRET;
        const response = await request(buildSignedApp()).get('/health');
        expect(response.status).toBe(200);
    });
});
