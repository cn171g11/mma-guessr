/**
 * 腾讯街景（QQ Map Street View）数据接口客户端 · 仅用于可行性测试
 *
 * 接口来源：对第三方查看器 https://qq-map.netlify.app/ 的前端产物做静态逆向得到，
 * 最终请求的是腾讯官方街景域名（不依赖该第三方站点）。逆向与验证过程见同目录 README.md。
 *
 * 三个端点：
 *   GET https://sv.map.qq.com/xf?lat=&lng=&r=&output=json        坐标 → 最近街景 svid
 *   GET https://sv.map.qq.com/sv?svid=&output=json               svid → 全景详情（basic/addr/all_scenes/history/region/roads/vpoints）
 *   GET https://sv1.map.qq.com/tile?from=web&svid=&level=&x=&y=  全景瓦片（JPEG）
 *   GET https://sv1.map.qq.com/thumb?from=web&svid=&level=0&x=0&y=0  全景缩略图（JPEG）
 *
 * 两个响应都为 GBK 编码的 application/javascript，必须按 GBK 解码（fetch 的 .text() 强制按 UTF-8 解，不可用）。
 */
(function (global) {
    'use strict';

    /** 主接口域名；第二个为第三方公共代理，主域名不可达时依次尝试 */
    var API_HOSTS = ['https://sv.map.qq.com', 'https://qq-api-proxy.map-making.app'];
    /** 瓦片域名 */
    var TILE_HOST = 'https://sv1.map.qq.com';
    /** Web Mercator 投影的最大值，用于把墨卡托米还原成经纬度 */
    var MERCATOR_MAX = 20037508.34;
    /** 单次请求默认超时 */
    var DEFAULT_TIMEOUT = 20000;

    var gbkDecoder = null;
    var traceCallback = null;

    function gbkDecode(buffer) {
        if (!gbkDecoder) gbkDecoder = new TextDecoder('gbk');
        return gbkDecoder.decode(new Uint8Array(buffer));
    }

    /** 记录一条诊断信息，交给页面渲染 */
    function trace(stage, detail) {
        if (typeof traceCallback === 'function') traceCallback(stage, detail);
    }

    /**
     * 带超时与计时的 GET，返回原始 ArrayBuffer。
     * 不发送 credentials，避免把测试站点的 Cookie 带给腾讯。
     */
    function getBuffer(url, timeout) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () {
            ctrl.abort();
        }, timeout || DEFAULT_TIMEOUT);
        var started = Date.now();
        return fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit', cache: 'no-store' })
            .then(function (res) {
                return res.arrayBuffer().then(function (buf) {
                    var out = {
                        ok: res.ok,
                        status: res.status,
                        bytes: buf.byteLength,
                        ms: Date.now() - started,
                        buffer: buf,
                    };
                    trace('http', { url: url, status: res.status, ms: out.ms, bytes: out.bytes, ok: res.ok });
                    return out;
                });
            })
            .catch(function (err) {
                trace('http', {
                    url: url,
                    status: 0,
                    ms: Date.now() - started,
                    bytes: 0,
                    ok: false,
                    message: String((err && err.message) || err),
                });
                throw err;
            })
            .finally(function () {
                clearTimeout(timer);
            });
    }

    /** 依次尝试各个 API 主机，返回第一个成功的响应 */
    function apiGet(path, timeout) {
        var index = 0;
        function attempt() {
            if (index >= API_HOSTS.length) throw new Error('所有接口主机均不可达：' + API_HOSTS.join(', '));
            var host = API_HOSTS[index++];
            var url = host + path;
            return getBuffer(url, timeout).catch(function (err) {
                trace('warn', {
                    label: '接口主机不可达，切换下一个',
                    url: host,
                    message: String(err && err.message ? err.message : err),
                });
                return attempt();
            });
        }
        return attempt();
    }

    /** 墨卡托米 → 经纬度（all_scenes / roads / vpoints 均使用该坐标系） */
    function mercatorToLngLat(x, y) {
        var lng = (x / MERCATOR_MAX) * 180;
        var lat = (y / MERCATOR_MAX) * 180;
        lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
        return { lng: lng, lat: lat };
    }

    /** 两点间罗盘方位角（度，0=正北，顺时针） */
    function bearing(fromLat, fromLng, toLat, toLng) {
        var toRad = Math.PI / 180;
        var dLng = (toLng - fromLng) * toRad;
        var y = Math.sin(dLng) * Math.cos(toLat * toRad);
        var x =
            Math.cos(fromLat * toRad) * Math.sin(toLat * toRad) -
            Math.sin(fromLat * toRad) * Math.cos(toLat * toRad) * Math.cos(dLng);
        return (Math.atan2(y, x) / toRad + 360) % 360;
    }

    /** 两点间距离（米，球面近似） */
    function distance(fromLat, fromLng, toLat, toLng) {
        var toRad = Math.PI / 180;
        var dLat = (toLat - fromLat) * toRad;
        var dLng = (toLng - fromLng) * toRad;
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(fromLat * toRad) * Math.cos(toLat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * 坐标 → 最近街景点。
     * 注意：errno 为 0 但 svid 为空字符串，表示该坐标周边无街景覆盖（并非请求失败），
     * 因此调用方必须显式判空；天安门、杭州西湖等点位实测确实无覆盖。
     */
    function findPano(lat, lng, radius) {
        var r = radius || 200;
        var path = '/xf?lat=' + lat + '&lng=' + lng + '&r=' + r + '&output=json';
        return apiGet(path).then(function (out) {
            var json = JSON.parse(gbkDecode(out.buffer));
            var detail = (json && json.detail) || null;
            var svid = detail && detail.svid ? detail.svid : '';
            trace(svid ? 'ok' : 'empty', {
                label: svid ? '命中街景点' : '该坐标无街景覆盖',
                url: path,
                status: out.status,
                ms: out.ms,
                bytes: out.bytes,
                note: svid ? 'svid=' + svid + '  errno=' + (json.info && json.info.errno) : 'errno=' + (json.info && json.info.errno) + ' svid 为空串',
            });
            return detail;
        });
    }

    /** svid → 全景详情 */
    function getPano(svid) {
        var path = '/sv?svid=' + svid + '&output=json';
        return apiGet(path, 25000).then(function (out) {
            var json = JSON.parse(gbkDecode(out.buffer));
            var detail = (json && json.detail) || null;
            var basic = (detail && detail.basic) || {};
            trace(detail ? 'ok' : 'empty', {
                label: detail ? '取回全景详情' : '全景详情为空',
                url: path,
                status: out.status,
                ms: out.ms,
                bytes: out.bytes,
                note: detail
                    ? 'dir=' +
                      basic.dir +
                      ' 网格=' +
                      basic.level0 +
                      ' 瓦片=' +
                      basic.tile_width +
                      'px 场景=' +
                      basic.type +
                      '/' +
                      basic.source +
                      ' 相邻点=' +
                      ((detail.all_scenes && detail.all_scenes.length) || 0)
                    : 'detail 字段缺失',
            });
            return detail;
        });
    }

    function thumbUrl(svid) {
        return TILE_HOST + '/thumb?from=web&svid=' + encodeURIComponent(svid) + '&level=0&x=0&y=0';
    }

    function tileUrl(svid, level, x, y) {
        return (
            TILE_HOST +
            '/tile?from=web&svid=' +
            encodeURIComponent(svid) +
            '&level=' +
            level +
            '&x=' +
            x +
            '&y=' +
            y
        );
    }

    /** 解析 "行*列" 形式的网格描述，例如 level0 = "4*8" → { rows: 4, cols: 8 } */
    function parseGrid(desc, fallbackRows, fallbackCols) {
        var parts = String(desc || '').split('*');
        var rows = parseInt(parts[0], 10);
        var cols = parseInt(parts[1], 10);
        return {
            rows: isNaN(rows) ? fallbackRows : rows,
            cols: isNaN(cols) ? fallbackCols : cols,
        };
    }

    /**
     * 下载一层的全部瓦片并拼成一张 equirect 全景图（返回 canvas）。
     * onProgress(done, total) 用于页面进度显示。
     */
    function buildMosaic(svid, opts) {
        var options = opts || {};
        var level = options.level || 0;
        var grid = options.grid || { rows: 4, cols: 8 };
        var tileSize = options.tileSize || 512;
        var onProgress = options.onProgress;
        var canvas = document.createElement('canvas');
        canvas.width = grid.cols * tileSize;
        canvas.height = grid.rows * tileSize;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111820';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        var tasks = [];
        var done = 0;
        var total = grid.rows * grid.cols;
        var failed = [];
        var started = Date.now();

        for (var y = 0; y < grid.rows; y++) {
            for (var x = 0; x < grid.cols; x++) {
                tasks.push({ x: x, y: y });
            }
        }

        return Promise.all(
            tasks.map(function (cell) {
                var url = tileUrl(svid, level, cell.x, cell.y);
                return getBuffer(url, 20000)
                    .then(function (out) {
                        if (!out.ok || out.bytes < 100) throw new Error('HTTP ' + out.status + ' / ' + out.bytes + 'B');
                        var blobUrl = URL.createObjectURL(new Blob([out.buffer], { type: 'image/jpeg' }));
                        return new Promise(function (resolve, reject) {
                            var img = new Image();
                            img.onload = function () {
                                ctx.drawImage(img, cell.x * tileSize, cell.y * tileSize, tileSize, tileSize);
                                URL.revokeObjectURL(blobUrl);
                                resolve({ cell: cell, bytes: out.bytes, ms: out.ms });
                            };
                            img.onerror = function () {
                                URL.revokeObjectURL(blobUrl);
                                reject(new Error('图片解码失败'));
                            };
                            img.src = blobUrl;
                        });
                    })
                    .catch(function (err) {
                        failed.push({ cell: cell, message: String(err.message || err) });
                        return { cell: cell, failed: true };
                    })
                    .then(function (res) {
                        done++;
                        if (typeof onProgress === 'function') onProgress(done, total);
                        return res;
                    });
            })
        ).then(function (results) {
            var bytes = results.reduce(function (sum, r) {
                return sum + (r.bytes || 0);
            }, 0);
            trace(failed.length ? 'warn' : 'ok', {
                label: '拼接全景图 L' + level,
                url: tileUrl(svid, level, 0, 0) + ' … 共 ' + total + ' 张',
                status: failed.length ? '部分失败' : 200,
                ms: Date.now() - started,
                bytes: bytes,
                note:
                    canvas.width +
                    '×' +
                    canvas.height +
                    ' · 成功 ' +
                    (total - failed.length) +
                    '/' +
                    total +
                    (failed.length ? ' · 失败 ' + JSON.stringify(failed.slice(0, 3)) : ''),
            });
            return { canvas: canvas, failed: failed, total: total };
        });
    }

    /** 取一张缩略图，返回 object URL 与字节数 */
    function loadThumb(svid) {
        var url = thumbUrl(svid);
        return getBuffer(url, 20000).then(function (out) {
            trace(out.ok ? 'ok' : 'warn', {
                label: '全景缩略图',
                url: url,
                status: out.status,
                ms: out.ms,
                bytes: out.bytes,
                note: out.ok ? 'image/jpeg' : '加载失败',
            });
            if (!out.ok) return null;
            return { url: URL.createObjectURL(new Blob([out.buffer], { type: 'image/jpeg' })), bytes: out.bytes };
        });
    }

    /** 从全景详情中挑出距离最近的若干相邻采集点，用于核对朝向 */
    function nearbyScenes(detail, limit) {
        var basic = (detail && detail.basic) || {};
        var addr = (detail && detail.addr) || {};
        var scenes = (detail && detail.all_scenes) || [];
        if (!addr.y_lat || !addr.x_lng) return [];
        return scenes
            .map(function (scene) {
                var pos = mercatorToLngLat(scene.x, scene.y);
                return {
                    svid: scene.svid,
                    lat: pos.lat,
                    lng: pos.lng,
                    distance: distance(addr.y_lat, addr.x_lng, pos.lat, pos.lng),
                    bearing: bearing(addr.y_lat, addr.x_lng, pos.lat, pos.lng),
                };
            })
            .filter(function (scene) {
                return scene.svid !== basic.svid;
            })
            .sort(function (a, b) {
                return a.distance - b.distance;
            })
            .slice(0, limit || 5);
    }

    global.QQSv = {
        API_HOSTS: API_HOSTS,
        TILE_HOST: TILE_HOST,
        setTrace: function (fn) {
            traceCallback = fn;
        },
        findPano: findPano,
        getPano: getPano,
        thumbUrl: thumbUrl,
        tileUrl: tileUrl,
        parseGrid: parseGrid,
        buildMosaic: buildMosaic,
        loadThumb: loadThumb,
        nearbyScenes: nearbyScenes,
        mercatorToLngLat: mercatorToLngLat,
        bearing: bearing,
        distance: distance,
    };
})(typeof window !== 'undefined' ? window : globalThis);
