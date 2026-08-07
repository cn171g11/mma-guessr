// MmaGuessr · 后端 API 客户端
// 依赖 src/js/config.js（HTML 中在其后加载）。
// 后端不可达时静默降级为离线状态，游戏继续以纯本地模式运行。

const MmaApi = (() => {
    const ACCESS_KEY = 'mma_access_token';
    const GUEST_KEY = 'mma_guest_token';

    let identity = null; // { role: 'guest'|'user', profile|user, progress }
    let isOnline = false;

    function storedToken() {
        return localStorage.getItem(ACCESS_KEY) || localStorage.getItem(GUEST_KEY) || null;
    }

    // 刷新令牌经 HttpOnly Cookie 由服务端下发，本地仅保留短期访问令牌
    function storeUserTokens(pair) {
        localStorage.setItem(ACCESS_KEY, pair.accessToken);
        localStorage.removeItem(GUEST_KEY);
    }

    function clearTokens() {
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(GUEST_KEY);
    }

    function setOffline() {
        isOnline = false;
        identity = null;
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

    async function tryRefresh() {
        // 刷新令牌随 HttpOnly Cookie 自动回传，无需本地读取
        try {
            const response = await fetch(API_BASE + '/api/auth/refresh', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!response.ok) return false;
            const payload = await response.json();
            const accessToken = payload && payload.tokenPair && payload.tokenPair.accessToken;
            if (!accessToken) return false;
            localStorage.setItem(ACCESS_KEY, accessToken);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function request(path, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        const token = storedToken();
        if (token) headers.Authorization = 'Bearer ' + token;

        let response;
        try {
            response = await fetch(API_BASE + path, {
                method: options.method || 'GET',
                headers,
                body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                credentials: 'include',
            });
        } catch (e) {
            setOffline();
            throw e;
        }

        if (response.status === 401 && localStorage.getItem(ACCESS_KEY) && !options.retried) {
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
        if (!storedToken()) {
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

    return {
        init,
        isOnline: () => isOnline,
        getIdentity: () => identity,
        getAccessToken: () => localStorage.getItem(ACCESS_KEY),
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
