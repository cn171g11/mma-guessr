// MmaGuessr · Service Worker（PWA 离线 / 缓存）
// CACHE_VERSION 必须与 config.js 的 VERSION 同步，升级即建立新缓存并清理旧版。
// 策略：
//   · 应用页（navigate）：网络优先，失败回退缓存壳（支持弱网/离线打开）
//   · 本域静态资源（js/css/svg/webmanifest）：缓存优先，未命中走网络
//   · 本域 /api 与 /socket.io：绝不缓存（动态数据/鉴权请求）
//   · 跨域静态（Leaflet/unpkg/CDN、街景缩略、OSM 瓦片）：缓存优先，支持离线地图瓦片
const CACHE_VERSION = '2.0.0';
const STATIC_CACHE = 'mma-guessr-static-' + CACHE_VERSION;

const PRECACHE_URLS = [
    './index.html',
    './css/style.css',
    './js/config.js',
    './js/data.js',
    './js/api.js',
    './js/game.js',
    './js/auth.js',
    './js/lb.js',
    './js/daily.js',
    './js/mp.js',
    './js/sw-register.js',
    './manifest.webmanifest',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

function isCacheableResponse(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque');
}

// 缓存优先：命中即返回，未命中请求网络并顺手入缓存
function cacheFirst(event) {
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                return cached;
            }
            return fetch(event.request).then((response) => {
                if (isCacheableResponse(response)) {
                    const copy = response.clone();
                    void caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
                }
                return response;
            });
        })
    );
}

// 网络优先：成功则入缓存；失败（离线/弱网）回退缓存，最后兜底应用壳
function networkFirst(event) {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (isCacheableResponse(response)) {
                    const copy = response.clone();
                    void caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
}

// 允许被缓存（缓存优先）的跨域静态资源主机白名单：
// 仅限代码中引用的 CDN、地图瓦片与图标；其余跨域请求一律直连不入缓存，防止缓存污染
const CROSS_ORIGIN_CACHE_HOSTS = [
    'unpkg.com',
    'cdn.socket.io',
    'cdnjs.cloudflare.com',
    'raw.githubusercontent.com',
    'a.tile.openstreetmap.org',
    'b.tile.openstreetmap.org',
    'c.tile.openstreetmap.org',
];

function isAllowlistedCrossOrigin(url) {
    return CROSS_ORIGIN_CACHE_HOSTS.includes(url.hostname);
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    // 本域 API / Socket.IO 动态数据：绝不拦截，直连网络
    if (url.origin === self.location.origin) {
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
            return;
        }
        if (request.mode === 'navigate') {
            networkFirst(event);
            return;
        }
        cacheFirst(event);
        return;
    }

    // 仅缓存白名单内的跨域静态资源（Leaflet CDN / OSM 瓦片 / 标记图标）
    if (url.protocol === 'https:' && isAllowlistedCrossOrigin(url)) {
        cacheFirst(event);
    }
});
