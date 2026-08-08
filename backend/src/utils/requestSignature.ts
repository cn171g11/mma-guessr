import crypto from 'node:crypto';

// 请求签名（服务端与前端必须保持一致）：
// 对 [timestamp, nonce, method, path, bodyHash] 以 '\n' 连接后做 HMAC-SHA256
export const SIGNATURE_HEADER = 'x-request-signature';
export const TIMESTAMP_HEADER = 'x-request-timestamp';
export const NONCE_HEADER = 'x-request-nonce';

// 时间戳容忍窗口：超过该偏差的请求视为无效（配合 nonce 防重放）
export const REQUEST_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

// nonce 至少 16 位、仅含 URL 安全字符，用于一次性标记并限制长度防止超长输入
export const NONCE_PATTERN = /^[0-9A-Za-z-]{16,64}$/;

export function hashRequestBody(body: string): string {
    return crypto.createHash('sha256').update(body).digest('hex');
}

export function buildSignatureMessage(input: {
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    body: string;
}): string {
    return [input.timestamp, input.nonce, input.method, input.path, hashRequestBody(input.body)].join('\n');
}

export function computeRequestSignature(secret: string, message: string): string {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
}
