// MmaGuessr · 后端 API 客户端
// 依赖 src/js/config.js（HTML 中在其后加载）。
// 后端不可达时静默降级为离线状态，游戏继续以纯本地模式运行。

const MmaApi = (() => {
    // 历史遗留的 localStorage 访问令牌键：旧版本曾存放在此，启动即清理，不再写入
    const ACCESS_KEY = 'mma_access_token';
    const GUEST_KEY = 'mma_guest_token';
    // 跨标签页刷新协调：刷新令牌轮换会在服务端使旧令牌立即失效，
    // 多个标签页同时刷新会互相吊销，故用锁 + 广播保证同一时刻只有一个标签页发起刷新
    const REFRESH_LOCK_KEY = 'mma_refresh_lock';
    const REFRESH_CHANNEL_NAME = 'mma-auth';
    const REFRESH_LOCK_TTL_MS = 3000;
    const REFRESH_BROADCAST_WAIT_MS = 4000;

    let identity = null; // { role: 'guest'|'user', profile|user, progress }
    let isOnline = false;
    // 注册用户访问令牌仅保存在内存：页面刷新后经 HttpOnly 刷新令牌重新获取，
    // XSS 无法从 localStorage / sessionStorage 读到短期令牌
    let userAccessToken = null;
    // 单飞刷新：多个 401 并发时只发一次 /auth/refresh
    let refreshInFlight = null;
    let authChannel = null;

    if (typeof BroadcastChannel !== 'undefined') {
        authChannel = new BroadcastChannel(REFRESH_CHANNEL_NAME);
        authChannel.onmessage = (event) => {
            if (event.data && event.data.type === 'access-token' && typeof event.data.accessToken === 'string') {
                userAccessToken = event.data.accessToken;
                localStorage.removeItem(ACCESS_KEY);
            }
        };
    }

    function broadcastAccessToken(accessToken) {
        if (authChannel) authChannel.postMessage({ type: 'access-token', accessToken });
    }

    // 抢占刷新锁；失败说明另一标签页刚发起过刷新，等待其广播即可
    function acquireRefreshLock() {
        try {
            const lastLock = Number(localStorage.getItem(REFRESH_LOCK_KEY) || 0);
            if (Date.now() - lastLock < REFRESH_LOCK_TTL_MS) return false;
            localStorage.setItem(REFRESH_LOCK_KEY, String(Date.now()));
            return true;
        } catch (e) {
            return true;
        }
    }

    function releaseRefreshLock() {
        try {
            localStorage.removeItem(REFRESH_LOCK_KEY);
        } catch (e) {
            /* localStorage 不可用时无需释放 */
        }
    }

    async function waitForBroadcastAccessToken() {
        const deadline = Date.now() + REFRESH_BROADCAST_WAIT_MS;
        while (Date.now() < deadline) {
            if (userAccessToken) return userAccessToken;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
    }

    function storedToken() {
        return userAccessToken || localStorage.getItem(GUEST_KEY) || null;
    }

    function storeUserTokens(pair) {
        userAccessToken = pair.accessToken;
        localStorage.removeItem(GUEST_KEY);
        localStorage.removeItem(ACCESS_KEY);
    }

    function clearTokens() {
        userAccessToken = null;
        localStorage.removeItem(GUEST_KEY);
        localStorage.removeItem(ACCESS_KEY);
    }

    function setOffline() {
        isOnline = false;
        identity = null;
    }

    // ==========================================================
    // 【请求签名】：HMAC-SHA256(timestamp\nnonce\nmethod\npath\nbodyHash)
    // 服务端校验 ±5 分钟时间窗并发起 nonce 去重（防篡改 / 防重放）。
    // WebCrypto 仅在安全上下文（HTTPS / localhost）可用；file:// 下自动跳过签名。
    // ==========================================================
    function toHex(bytes) {
        return Array.from(bytes)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    async function computeSha256Hex(content) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
        return toHex(new Uint8Array(digest));
    }

    async function computeHmacHex(secret, message) {
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
        return toHex(new Uint8Array(signature));
    }

    function randomNonce() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return toHex(bytes);
    }

    async function signRequestHeaders(method, path, bodyString) {
        if (!API_SIGNING_SECRET || !window.crypto || !window.crypto.subtle) {
            return {};
        }
        const timestamp = String(Date.now());
        const nonce = randomNonce();
        const message = [timestamp, nonce, method, path, await computeSha256Hex(bodyString)].join('\n');
        const signature = await computeHmacHex(API_SIGNING_SECRET, message);
        return {
            'x-request-timestamp': timestamp,
            'x-request-nonce': nonce,
            'x-request-signature': signature,
        };
    }

    // 刷新令牌经 HttpOnly Cookie 自动回传，本地仅保留短期访问令牌于内存
    async function tryRefresh() {
        if (refreshInFlight) {
            return refreshInFlight;
        }
        refreshInFlight = (async () => {
            // 另一标签页正在刷新时等待其广播结果，避免并发刷新触发服务端令牌吊销
            if (!acquireRefreshLock()) {
                if ((await waitForBroadcastAccessToken()) !== null) return true;
                return false;
            }
            try {
                const signHeaders = await signRequestHeaders('POST', '/api/auth/refresh', '{}');
                const response = await fetch(API_BASE + '/api/auth/refresh', {
                    method: 'POST',
                    credentials: 'include',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, signHeaders),
                    body: '{}',
                });
                if (!response.ok) return false;
                const payload = await response.json();
                const accessToken = payload && payload.tokenPair && payload.tokenPair.accessToken;
                if (!accessToken) return false;
                userAccessToken = accessToken;
                localStorage.removeItem(ACCESS_KEY);
                broadcastAccessToken(accessToken);
                return true;
            } catch (e) {
                return false;
            } finally {
                refreshInFlight = null;
                releaseRefreshLock();
            }
        })();
        return refreshInFlight;
    }

    async function toHttpError(response) {
        let payload = null;
        try {
            payload = await response.json();
        } catch (e) {
            /* 响应体可能不是 JSON，此时仅用状态码描述错误 */
        }
        const error = new Error((payload && payload.error) || 'HTTP ' + response.status);
        error.status = response.status;
        return error;
    }

    async function request(path, options = {}) {
        const method = options.method || 'GET';
        const bodyString = options.body !== undefined ? JSON.stringify(options.body) : undefined;
        const headers = Object.assign(
            { 'Content-Type': 'application/json' },
            await signRequestHeaders(method, path, bodyString ?? '')
        );
        const token = storedToken();
        if (token) headers.Authorization = 'Bearer ' + token;

        let response;
        try {
            response = await fetch(API_BASE + path, {
                method,
                headers,
                body: bodyString,
                credentials: 'include',
            });
        } catch (e) {
            setOffline();
            throw e;
        }

        if (response.status === 401 && !options.retried) {
            if (await tryRefresh()) return request(path, { ...options, retried: true });
            clearTokens();
            identity = null;
            throw new Error('登录已过期');
        }
        if (!response.ok) throw await toHttpError(response);

        isOnline = true;
        if (response.status === 204) return null;
        return response.json();
    }

    async function createGuestSession() {
        try {
            const session = await request('/api/auth/guest', { method: 'POST' });
            localStorage.setItem(GUEST_KEY, session.guestToken);
            identity = {
                role: 'guest',
                profile: { guestId: session.guestId, username: session.username },
                progress: null,
            };
        } catch (e) {
            setOffline();
        }
    }

    async function init() {
        localStorage.removeItem(ACCESS_KEY);
        if (!storedToken() && !(await tryRefresh())) {
            await createGuestSession();
            return;
        }
        try {
            identity = await request('/api/auth/me');
        } catch (e) {
            setOffline();
        }
    }

    async function afterAuth(session) {
        storeUserTokens(session.tokenPair);
        identity = await request('/api/auth/me');
        return identity;
    }

    // 页面刷新后内存令牌已清空：尝试经 HttpOnly 刷新令牌恢复用户访问令牌（Socket.IO 握手前调用）
    async function ensureUserToken() {
        if (userAccessToken) return userAccessToken;
        await tryRefresh();
        return userAccessToken;
    }

    return {
        init,
        ensureUserToken,
        isOnline: () => isOnline,
        getIdentity: () => identity,
        getAccessToken: () => userAccessToken,
        getGuestToken: () => localStorage.getItem(GUEST_KEY),
        getMe: () => request('/api/auth/me'),
        getBest: (mode) => request('/api/games/best?mode=' + encodeURIComponent(mode)),
        getRecent: (limit) => request('/api/games/recent?limit=' + (limit || 20)),
        getSummary: () => request('/api/games/summary'),
        submitGame: (payload) => request('/api/games', { method: 'POST', body: payload }),
        deleteGame: (id) => request('/api/games/' + id, { method: 'DELETE' }),
        getProfile: () => request('/api/profile'),
        getAchievements: () => request('/api/achievements'),
        equipTitle: (title) => request('/api/achievements/title', { method: 'PUT', body: { title } }),
        getDaily: () => request('/api/daily/today'),
        getLeaderboard: (mode, period, limit, date) => {
            const params = new URLSearchParams({ mode, period, limit: String(limit || 20) });
            if (date) params.set('date', date);
            return request('/api/leaderboard?' + params.toString());
        },
        sendVerificationCode: (email) => request('/api/auth/verification-code', { method: 'POST', body: { email } }),
        login: (identifier, password) =>
            request('/api/auth/login', { method: 'POST', body: { identifier, password } }).then(afterAuth),
        register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }).then(afterAuth),
        logout: async () => {
            try {
                await request('/api/auth/logout', { method: 'POST', body: {} });
            } catch (e) {
                // 离线登出无需服务端确认
            }
            clearTokens();
            identity = null;
            isOnline = false;
        },
    };
})();
