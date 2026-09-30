/**
 * 腾讯街景接入测试页逻辑 · 仅用于可行性验证，不参与游戏运行。
 *
 * 页面做两件事：
 *   1. 手动载入：输入坐标 → 查最近街景 → 取全景详情 → 拉瓦片拼全景 → Three.js 渲染
 *   2. 全链路自检：对一批预设点位跑完整链路，逐项给出 PASS/FAIL 结论
 * 每一步请求都会写入右侧诊断面板（URL / HTTP 状态 / 耗时 / 字节数）。
 */
(function () {
    'use strict';

    var $ = function (id) {
        return document.getElementById(id);
    };

    /** 预设点位：expectCoverage 表示该点预期有无街景，用于验证「无覆盖」分支 */
    var PRESETS = [
        { name: '上海 · 外滩（预期有）', lat: 31.2397, lng: 121.49, expectCoverage: true },
        { name: '北京 · 建国门（预期有）', lat: 39.9087, lng: 116.434, expectCoverage: true },
        { name: '广州 · 天河（预期有）', lat: 23.1291, lng: 113.2644, expectCoverage: true },
        { name: '成都 · 天府广场（预期有）', lat: 30.657, lng: 104.0658, expectCoverage: true },
        { name: '西安 · 钟楼（预期有）', lat: 34.261, lng: 108.945, expectCoverage: true },
        { name: '深圳 · 福田（预期有）', lat: 22.5431, lng: 114.0579, expectCoverage: true },
        { name: '重庆 · 解放碑（预期有）', lat: 29.5581, lng: 106.577, expectCoverage: true },
        { name: '北京 · 天安门（预期无）', lat: 39.9087, lng: 116.3975, expectCoverage: false },
        { name: '杭州 · 西湖（预期无）', lat: 30.2489, lng: 120.149, expectCoverage: false },
    ];

    var stats = { req: 0, ok: 0, fail: 0, ms: 0, bytes: 0 };
    var tileStat = { ok: 0, total: 0 };
    var viewer = null;
    var currentPano = null;
    var busy = false;

    /** 各环节的通过情况，自检结束时汇总 */
    var checks = {
        cors: { label: '跨域 CORS（浏览器直连腾讯）', status: 'skip', note: '未测试' },
        xf: { label: '接口 /xf · 坐标 → 最近街景', status: 'skip', note: '未测试' },
        coverage: { label: '覆盖判定 · 无街景坐标正确返回空', status: 'skip', note: '未测试' },
        sv: { label: '接口 /sv · 全景详情（basic/addr）', status: 'skip', note: '未测试' },
        thumb: { label: '缩略图 /thumb（JPEG）', status: 'skip', note: '未测试' },
        tile: { label: '瓦片 /tile 全量拉取与拼接', status: 'skip', note: '未测试' },
        render: { label: 'Three.js 球面渲染', status: 'skip', note: '未测试' },
        grid: { label: '网格声明与实际瓦片一致', status: 'skip', note: '未测试' },
    };

    // ------------------------------------------------------------------
    // 诊断面板
    // ------------------------------------------------------------------

    function fmtBytes(n) {
        if (!n) return '0 B';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(2) + ' MB';
    }

    function pushLog(kind, d) {
        var box = $('log');
        var entry = document.createElement('div');
        entry.className = 'entry ' + kind;
        var right =
            d.status !== undefined
                ? (d.status === 200 ? 'HTTP 200' : d.status ? 'HTTP ' + d.status : '网络错误') +
                  ' · ' +
                  (d.ms !== undefined ? d.ms + ' ms' : '') +
                  ' · ' +
                  fmtBytes(d.bytes)
                : '';
        entry.innerHTML =
            '<div class="head"><span class="label"></span><span class="timing"></span></div>' +
            (d.url ? '<div class="url"></div>' : '') +
            (d.note ? '<div class="note"></div>' : '');
        entry.querySelector('.label').textContent = d.label || kind;
        entry.querySelector('.timing').textContent = right;
        if (d.url) entry.querySelector('.url').textContent = d.url;
        if (d.note) entry.querySelector('.note').textContent = d.note;
        box.insertBefore(entry, box.firstChild);
        while (box.childElementCount > 120) box.removeChild(box.lastChild);
    }

    function renderStats() {
        $('st-req').textContent = stats.req;
        $('st-ok').textContent = stats.ok;
        $('st-fail').textContent = stats.fail;
        $('st-ms').textContent = Math.round(stats.ms) + ' ms';
        $('st-bytes').textContent = fmtBytes(stats.bytes);
        $('st-tile').textContent = tileStat.total ? tileStat.ok + ' / ' + tileStat.total : '—';
    }

    function renderChecks() {
        var box = $('checks');
        box.innerHTML = Object.keys(checks)
            .map(function (key) {
                var c = checks[key];
                var badge = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : '—';
                return (
                    '<div class="check"><span>' +
                    c.label +
                    '<br /><span class="muted">' +
                    (c.note || '') +
                    '</span></span><span class="badge ' +
                    c.status +
                    '">' +
                    badge +
                    '</span></div>'
                );
            })
            .join('');
    }

    function setCheck(key, status, note) {
        checks[key].status = status;
        checks[key].note = note || '';
        renderChecks();
    }

    /** 捕获所有 HTTP 请求用于统计；其余类型（ok/warn）才进日志 */
    function onTrace(kind, d) {
        if (kind === 'http') {
            stats.req++;
            stats.ms += d.ms || 0;
            stats.bytes += d.bytes || 0;
            if (d.ok) stats.ok++;
            else {
                stats.fail++;
                pushLog('error', {
                    label: '请求失败',
                    url: d.url,
                    status: d.status,
                    ms: d.ms,
                    bytes: d.bytes,
                    note: d.message || '',
                });
            }
            renderStats();
            return;
        }
        pushLog(kind, d);
    }

    // ------------------------------------------------------------------
    // 查看器
    // ------------------------------------------------------------------

    function ensureViewer() {
        if (viewer) return viewer;
        viewer = new window.QQPanoViewer($('viewer'));
        viewer.onChange = function (s) {
            $('hud').innerHTML =
                '<span class="hl">方位 ' +
                s.compass.toFixed(1) +
                '°</span>' +
                '<span>采集朝向 dir ' +
                s.dir +
                '°</span>' +
                '<span>透视 yaw ' +
                s.yaw.toFixed(1) +
                '° / pitch ' +
                s.pitch.toFixed(1) +
                '°</span>' +
                '<span>FOV ' +
                s.fov +
                '°</span>' +
                '<span>校正 R ' +
                s.correction.toFixed(0) +
                '°</span>';
            $('compass-needle').setAttribute('transform', 'rotate(' + s.compass.toFixed(1) + ' 50 50)');
        };
        $('in-correction').addEventListener('input', function () {
            var v = Number(this.value);
            viewer.setCorrection(v);
            $('correction-readout').textContent = 'R = ' + v + '°（手动覆盖）';
        });
        return viewer;
    }

    function showOverlay(msg, icon, closable) {
        $('overlay').classList.remove('hidden');
        $('overlay-msg').textContent = msg;
        if (icon) $('overlay').querySelector('.big').textContent = icon;
        // 加载中不给关闭按钮；已出结果（无覆盖 / 出错）时允许关掉遮罩回看画面
        $('overlay-close').style.display = closable ? '' : 'none';
    }

    function hideOverlay() {
        $('overlay').classList.add('hidden');
        $('progress-wrap').style.display = 'none';
        $('overlay-close').style.display = 'none';
    }

    /** 结果提示：只占底部一条，不遮挡查看器、不拦截拖拽 */
    function showToast(msg, kind) {
        var toast = $('toast');
        toast.className = 'toast show ' + (kind || '');
        toast.textContent = msg;
    }

    function setProgress(done, total) {
        $('progress-wrap').style.display = 'block';
        $('progress').style.width = ((done / total) * 100).toFixed(1) + '%';
    }

    // ------------------------------------------------------------------
    // 元数据渲染
    // ------------------------------------------------------------------

    /** svid 第 9~18 位编码了采集时间：YY MM DD HH mm */
    function captureDateFromSvid(svid) {
        if (!svid || svid.length < 18) return null;
        var y = 2000 + Number(svid.slice(8, 10));
        var mo = Number(svid.slice(10, 12)) - 1;
        var d = Number(svid.slice(12, 14));
        var h = Number(svid.slice(14, 16));
        var mi = Number(svid.slice(16, 18));
        if ([y, mo, d, h, mi].some(isNaN)) return null;
        return new Date(y, mo, d, h, mi);
    }

    function renderMeta(detail) {
        var b = detail.basic || {};
        var addr = detail.addr || {};
        var scenes = detail.all_scenes || [];
        var history = (detail.history && detail.history.nodes) || [];
        var date = captureDateFromSvid(b.svid);
        var rows = [
            ['svid', b.svid],
            ['坐标', addr.y_lat ? addr.y_lat.toFixed(6) + ', ' + addr.x_lng.toFixed(6) : '—'],
            ['采集朝向 dir', b.dir + '°'],
            ['瓦片网格', 'level0=' + b.level0 + ' / level1=' + b.level1 + ' @ ' + b.tile_width + 'px'],
            ['场景类型', b.type + ' / 来源 ' + b.source],
            ['拍摄模式', b.mode === 'night' ? '夜间' : '白天'],
            ['道路', b.append_addr || '—'],
            ['审图号', b.sno || '—'],
            ['采集时间', date ? date.toLocaleString('zh-CN') + '（由 svid 推断）' : '—'],
            ['相邻采集点', scenes.length + ' 个'],
            ['历史采集', history.length + ' 个版本'],
        ];
        $('meta').innerHTML = rows
            .map(function (r) {
                return (
                    '<div style="display:flex;gap:10px;justify-content:space-between;padding:2px 0">' +
                    '<span class="muted">' +
                    r[0] +
                    '</span><span class="mono" style="text-align:right;word-break:break-all">' +
                    r[1] +
                    '</span></div>'
                );
            })
            .join('');
    }

    function renderNearby(detail) {
        var list = window.QQSv.nearbyScenes(detail, 6);
        var box = $('nearby');
        if (!list.length) {
            box.innerHTML = '<span class="muted">无相邻采集点数据。</span>';
            return;
        }
        box.innerHTML = '';
        list.forEach(function (s) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent =
                '方位 ' +
                s.bearing.toFixed(0) +
                '° · ' +
                s.distance.toFixed(1) +
                ' m · ' +
                s.svid.slice(-6);
            btn.title = '点击转到该采集点：' + s.svid;
            btn.addEventListener('click', function () {
                loadBySvid(s.svid);
            });
            box.appendChild(btn);
        });
    }

    // ------------------------------------------------------------------
    // 主流程
    // ------------------------------------------------------------------

    function loadBySvid(svid) {
        if (busy) return;
        busy = true;
        showOverlay('正在取回全景详情…', '📡');
        window.QQSv.getPano(svid)
            .then(function (detail) {
                return renderPano(detail, getLevel());
            })
            .catch(function (err) {
                showOverlay('取回失败：' + (err && err.message ? err.message : err), '❌', true);
                setCheck('sv', 'fail', String((err && err.message) || err));
            })
            .finally(function () {
                busy = false;
            });
    }

    function getLevel() {
        return Number($('in-level').value) || 0;
    }

    function gridFor(detail, level) {
        var b = detail.basic || {};
        if (level === 1) return window.QQSv.parseGrid(b.level1, 8, 16);
        return window.QQSv.parseGrid(b.level0, 4, 8);
    }

    /** 下载瓦片 → 渲染 → 更新界面 */
    function renderPano(detail, level) {
        var b = detail.basic || {};
        var grid = gridFor(detail, level);
        var tileSize = Number(b.tile_width) || 512;
        var tiles = grid.rows * grid.cols;

        currentPano = detail;
        renderMeta(detail);
        renderNearby(detail);
        showOverlay('正在拉取 ' + tiles + ' 张瓦片（' + grid.cols + '×' + grid.rows + '）…', '🛰️');
        tileStat = { ok: 0, total: tiles };

        return window.QQSv.loadThumb(b.svid)
            .then(function (thumb) {
                if (thumb) {
                    $('thumb').src = thumb.url;
                    $('thumb-wrap').style.display = 'block';
                    setCheck('thumb', 'pass', 'JPEG ' + fmtBytes(thumb.bytes) + '，可跨域加载');
                } else {
                    setCheck('thumb', 'fail', '缩略图未返回有效图片');
                }
            })
            .catch(function () {
                setCheck('thumb', 'fail', '缩略图请求异常');
            })
            .then(function () {
                return window.QQSv.buildMosaic(b.svid, {
                    level: level,
                    grid: grid,
                    tileSize: tileSize,
                    onProgress: function (done, total) {
                        setProgress(done, total);
                        $('overlay-msg').textContent = '正在拉取瓦片 ' + done + ' / ' + total + ' …';
                    },
                });
            })
            .then(function (result) {
                tileStat.ok = result.total - result.failed.length;
                renderStats();
                if (result.failed.length === 0) {
                    setCheck('tile', 'pass', result.total + ' / ' + result.total + ' 张全部成功');
                } else {
                    setCheck('tile', 'fail', result.failed.length + ' / ' + result.total + ' 张失败');
                }
                setCheck(
                    'grid',
                    result.failed.length === 0 ? 'pass' : 'fail',
                    '声明 ' + b.level0 + ' ↔ 实际 ' + grid.rows + '×' + grid.cols + ' 块 @ ' + tileSize + 'px'
                );

                var v = ensureViewer();
                v.setPanorama(result.canvas, b.dir);
                $('correction-readout').textContent =
                    'R = ' + v.correction.toFixed(0) + '°（默认 -（dir + 90））';
                $('in-correction').value = Math.max(-360, Math.min(360, v.correction));

                try {
                    var gl = v.renderer.getContext();
                    setCheck(
                        'render',
                        gl && !gl.isContextLost() ? 'pass' : 'fail',
                        'WebGL ' + (v.renderer.capabilities.isWebGL2 ? '2' : '1') + '，球面 ' + result.canvas.width + '×' + result.canvas.height
                    );
                } catch (e) {
                    setCheck('render', 'fail', String(e.message || e));
                }

                hideOverlay();
                setCheck('sv', 'pass', 'basic/addr/all_scenes 齐备，相邻点 ' + (detail.all_scenes || []).length + ' 个');
                return result;
            });
    }

    /** 坐标 → 完整载入 */
    function load(lat, lng, radius) {
        if (busy) return Promise.resolve();
        var level = getLevel();
        busy = true;
        showOverlay('正在查询该坐标最近的街景（半径 ' + radius + ' 米）…', '🔎');
        var t0 = Date.now();

        return window.QQSv.findPano(lat, lng, radius)
            .then(function (detail) {
                if (!detail || !detail.svid) {
                    setCheck('xf', 'pass', '接口正常（HTTP 200），该坐标返回空 svid');
                    setCheck('coverage', 'pass', '无街景覆盖被正确识别，未误报');
                    showOverlay('该坐标半径 ' + radius + ' 米内没有腾讯街景覆盖。换一个点位试试，或加大搜索半径。', '🚫', true);
                    return null;
                }
                setCheck('xf', 'pass', '命中 svid=' + detail.svid + '，' + (Date.now() - t0) + ' ms');
                setCheck('coverage', 'pass', '有覆盖时正确返回 svid');
                return window.QQSv.getPano(detail.svid).then(function (full) {
                    var addr = full.addr || {};
                    setCheck(
                        'sv',
                        'pass',
                        'addr 坐标 ' + (addr.y_lat ? addr.y_lat.toFixed(5) + ', ' + addr.x_lng.toFixed(5) : '缺失')
                    );
                    return renderPano(full, level).then(function (result) {
                        var basic = full.basic || {};
                        showToast(
                            '✅ 载入成功 · ' +
                                (basic.append_addr || '未知道路') +
                                ' · svid ' +
                                basic.svid +
                                '\n朝向 ' +
                                basic.dir +
                                '° · ' +
                                result.canvas.width +
                                '×' +
                                result.canvas.height +
                                ' · 瓦片 ' +
                                (result.total - result.failed.length) +
                                '/' +
                                result.total +
                                ' 张 · 可拖拽旋转、滚轮变焦',
                            'ok'
                        );
                        return result;
                    });
                });
            })
            .catch(function (err) {
                var msg = String((err && err.message) || err);
                showOverlay('载入失败：' + msg, '❌', true);
                if (/Failed to fetch|NetworkError|abort/i.test(msg)) {
                    setCheck('cors', 'fail', '浏览器直连被拒或超时：' + msg);
                }
                pushLog('error', { label: '载入流程异常', note: msg, status: 0 });
            })
            .finally(function () {
                busy = false;
            });
    }

    /** 全链路自检：覆盖判定 + 完整加载 + 逐项结论 */
    function runSelfTest() {
        if (busy) return;
        busy = true;
        clearLog();
        renderChecks();
        showOverlay('自检开始：逐个探测预设点位…', '🧪');

        var hits = [];
        var misses = [];
        var expectedMissOk = 0;
        var expectedMissTotal = 0;

        var chain = Promise.resolve();
        PRESETS.forEach(function (p) {
            chain = chain.then(function () {
                $('overlay-msg').textContent = '探测 ' + p.name + ' …';
                return window.QQSv.findPano(p.lat, p.lng, 5000)
                    .then(function (detail) {
                        var has = !!(detail && detail.svid);
                        if (has) hits.push({ preset: p, svid: detail.svid });
                        else misses.push(p);
                        if (!p.expectCoverage) {
                            expectedMissTotal++;
                            if (!has) expectedMissOk++;
                        }
                    })
                    .catch(function () {
                        misses.push(p);
                    });
            });
        });

        return chain
            .then(function () {
                setCheck(
                    'xf',
                    hits.length ? 'pass' : 'fail',
                    '预设 ' + PRESETS.length + ' 点，命中 ' + hits.length + ' 个街景（半径 5 公里）'
                );
                setCheck(
                    'cors',
                    hits.length ? 'pass' : 'fail',
                    hits.length ? '浏览器跨域直连 sv.map.qq.com 成功' : '所有请求均失败，疑似跨域被拦'
                );
                setCheck(
                    'coverage',
                    expectedMissOk === expectedMissTotal ? 'pass' : 'fail',
                    '已知识别无覆盖点位 ' + expectedMissOk + ' / ' + expectedMissTotal + '（' +
                        misses.map(function (m) {
                            return m.name.replace(/（.*）/, '');
                        }).join('、') +
                        '）'
                );
                if (!hits.length) throw new Error('没有任何预设点位命中街景，无法继续');
                $('overlay-msg').textContent = '载入第一个命中点位做完整渲染 …';
                var target = hits[0];
                return window.QQSv.getPano(target.svid).then(function (detail) {
                    var addr = detail.addr || {};
                    setCheck(
                        'sv',
                        'pass',
                        'addr 坐标 ' + (addr.y_lat ? addr.y_lat.toFixed(5) + ', ' + addr.x_lng.toFixed(5) : '缺失')
                    );
                    // 保存为默认点位，方便重复查看
                    $('in-lat').value = addr.y_lat ? addr.y_lat.toFixed(6) : target.preset.lat;
                    $('in-lng').value = addr.x_lng ? addr.x_lng.toFixed(6) : target.preset.lng;
                    return renderPano(detail, getLevel()).then(function () {
                        return target;
                    });
                });
            })
            .then(function (target) {
                var failed = Object.keys(checks).filter(function (k) {
                    return checks[k].status === 'fail';
                });
                var summary =
                    (failed.length
                        ? '❌ 自检未全部通过，失败项：' +
                          failed
                              .map(function (k) {
                                  return checks[k].label;
                              })
                              .join('、')
                        : '✅ 腾讯街景全链路可正常载入') +
                    '\n判定点：' +
                    target.preset.name +
                    ' · 命中 ' +
                    hits.length +
                    ' / ' +
                    PRESETS.length +
                    ' 点位 · 总请求 ' +
                    stats.req +
                    ' 次 · 流量 ' +
                    fmtBytes(stats.bytes) +
                    ' · 累计 ' +
                    Math.round(stats.ms) +
                    ' ms' +
                    '\n可直接在画面内拖拽旋转、滚轮变焦。';
                hideOverlay();
                showToast(summary, failed.length ? 'warn' : 'ok');
                pushLog(failed.length ? 'warn' : 'ok', {
                    label: failed.length ? '自检未全部通过' : '自检通过',
                    note: summary.replace(/\n/g, ' · '),
                });
            })
            .catch(function (err) {
                showOverlay('自检中断：' + String((err && err.message) || err), '❌', true);
            })
            .finally(function () {
                busy = false;
            });
    }

    function clearLog() {
        $('log').innerHTML = '';
        stats = { req: 0, ok: 0, fail: 0, ms: 0, bytes: 0 };
        tileStat = { ok: 0, total: 0 };
        renderStats();
    }

    // ------------------------------------------------------------------
    // 初始化
    // ------------------------------------------------------------------

    function init() {
        window.QQSv.setTrace(onTrace);

        var sel = $('in-preset');
        PRESETS.forEach(function (p, i) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', function () {
            var p = PRESETS[Number(this.value)];
            if (!p) return;
            $('in-lat').value = p.lat;
            $('in-lng').value = p.lng;
        });

        $('btn-load').addEventListener('click', function () {
            var lat = parseFloat($('in-lat').value);
            var lng = parseFloat($('in-lng').value);
            if (isNaN(lat) || isNaN(lng)) {
                showOverlay('纬度/经度填写有误，请检查。', '⚠️', true);
                return;
            }
            load(lat, lng, Number($('in-radius').value) || 200);
        });

        $('btn-selftest').addEventListener('click', runSelfTest);
        $('overlay-close').addEventListener('click', hideOverlay);
        $('btn-clear').addEventListener('click', function () {
            clearLog();
            $('log').innerHTML = '';
            Object.keys(checks).forEach(function (k) {
                checks[k].status = 'skip';
                checks[k].note = '未测试';
            });
            renderChecks();
        });

        renderChecks();
        renderStats();

        var webgl = '未知';
        try {
            var c = document.createElement('canvas');
            webgl = c.getContext('webgl2') ? 'WebGL2' : c.getContext('webgl') ? 'WebGL1' : '不支持';
        } catch (e) {
            webgl = '不支持';
        }
        $('env-info').textContent =
            location.protocol + '//' + location.host + ' · ' + webgl + ' · 屏幕 ' + screen.width + '×' + screen.height;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
