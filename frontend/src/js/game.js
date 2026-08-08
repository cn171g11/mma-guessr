// MmaGuessr · 游戏逻辑
// 依赖 src/js/config.js 与 src/js/data.js（HTML 中按该顺序加载）。
// 全局状态、计分、抽题、街景加载、UI 交互均在此文件中。

// ==========================================================
// 【全局状态】
// ==========================================================
const state = {
    mode: null,
    region: null,
    round: 0,
    totalScore: 0,
    current: null, // 当前地点 { name, lat, lng, ... } (lat/lng 为街景图片真实坐标)
    history: [], // [{name, distanceKm, score}]
    usedNames: new Set(),
    drawKey: null, // 当前抽题牌堆对应的题库 key（模式/区域/难度变化时重建）
    drawBag: [], // 洗牌后的地点牌堆，抽完才允许重复，保证各地区均衡出现
    timerId: null,
    timeLeft: 0,
    endless: { level: 1, xp: 0, totalXp: 0, roundsPlayed: 0 },
    finished: false,
};
let map = null,
    guessMarker = null,
    guessPoint = null,
    answerMarker = null,
    routeLine = null;
let isMapEnlarged = false,
    isSubmitting = false;
let streetViewError = null; // 最近一次街景加载失败的错误报告数据

const redIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});
const blueIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

const $ = (id) => document.getElementById(id);

// 渲染到 innerHTML 前的 HTML 转义，防止服务端/本地数据中的字符串被当作标签注入
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 多人对战开关：mp.js 在进入/退出对战时切换；提交与退出按钮据此路由到对战逻辑
let mpActive = false;
function routeSubmit() {
    if (mpActive) {
        mpSubmitGuess();
    } else {
        submitGuess();
    }
}
function routeQuit() {
    if (mpActive) {
        mpQuit();
    } else {
        quitGame();
    }
}

// ==========================================================
// 【历史最佳成绩 localStorage】
// ==========================================================
function bestKey(mode) {
    return 'geo_best_' + mode;
}
function getBest(mode) {
    try {
        return JSON.parse(localStorage.getItem(bestKey(mode)));
    } catch (e) {
        return null;
    }
}
function saveBestIfHigher(mode, data, cmpField) {
    const old = getBest(mode);
    if (!old || data[cmpField] > old[cmpField]) {
        localStorage.setItem(bestKey(mode), JSON.stringify(data));
        return true;
    }
    return false;
}
function renderLocalBests() {
    const c = getBest('classic');
    $('best-classic').textContent = c ? `历史最佳：${c.score} 分` : '历史最佳：--';
    const t = getBest('challenge');
    $('best-challenge').textContent = t ? `历史最佳：${t.score} 分` : '历史最佳：--';
    const cn = getBest('china');
    $('best-china').textContent = cn ? `历史最佳：${cn.score} 分` : '历史最佳：--';
    const r = getBest('region');
    $('best-region').textContent = r ? `历史最佳：${r.score} 分（${REGION_NAMES[r.region] || ''}）` : '历史最佳：--';
    const e = getBest('endless');
    $('best-endless').textContent = e ? `历史最佳：Lv.${e.level} · ${e.totalXp} 经验` : '历史最佳：--';
    const l = getBest('landmark');
    $('best-landmark').textContent = l ? `历史最佳：${l.score} 分` : '历史最佳：--';
}

const BEST_ELEMENTS = {
    classic: 'best-classic',
    challenge: 'best-challenge',
    china: 'best-china',
    region: 'best-region',
    endless: 'best-endless',
    landmark: 'best-landmark',
};

function fillBestText(mode, best) {
    const el = $(BEST_ELEMENTS[mode]);
    if (!best) {
        el.textContent = '历史最佳：--';
        return;
    }
    if (mode === 'endless') {
        // 服务端最佳记录不保存局内等级，以经验总量作为成绩展示
        const totalXp = best.rounds.reduce((sum, round) => sum + (round.xp || 0), 0);
        el.textContent = `历史最佳：${totalXp} 经验`;
    } else if (mode === 'region') {
        el.textContent = `历史最佳：${best.totalScore} 分（${REGION_NAMES[best.region] || ''}）`;
    } else {
        el.textContent = `历史最佳：${best.totalScore} 分`;
    }
}

// 在线时从服务端拉取各模式最佳；任一请求失败则整体回落到本地最佳
function renderBests() {
    if (!MmaApi.isOnline()) {
        renderLocalBests();
        return;
    }
    Promise.all(['classic', 'challenge', 'china', 'region', 'endless', 'landmark'].map((mode) => MmaApi.getBest(mode)))
        .then((bests) => {
            ['classic', 'challenge', 'china', 'region', 'endless', 'landmark'].forEach((mode, index) => {
                fillBestText(mode, bests[index].best);
            });
        })
        .catch(() => renderLocalBests());
}

// ==========================================================
// 【本地历史记录】
// 存储最近 20 局，每局含模式/得分/回合明细/Mapillary 图片 ID
// ==========================================================
const HIST_KEY = 'mma_guessr_history';
const HIST_MAX = 20;

function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(HIST_KEY)) || [];
    } catch (e) {
        return [];
    }
}
function saveHistory(arr) {
    localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(0, HIST_MAX)));
}

function saveGameHistory(options = {}) {
    if (state.mode === 'endless' && state.history.length === 0) return; // 没打成的不记
    const maxPossible = MODES[state.mode].rounds === Infinity ? null : MODES[state.mode].rounds * MAX_SCORE;
    const game = {
        id: Date.now(),
        date: new Date().toLocaleString('zh-CN', { hour12: false }),
        mode: state.mode,
        modeLabel: MODES[state.mode].label,
        region: state.region || null,
        regionName: state.region ? REGION_NAMES[state.region] : null,
        totalScore: state.totalScore,
        maxScore: maxPossible,
        rounds: state.history.map((h) => ({
            name: h.name,
            distanceKm: h.distanceKm,
            score: h.score,
            imageId: h.imageId || null,
        })),
    };
    const all = loadHistory();
    all.unshift(game);
    saveHistory(all);
    // 在线时同步上报服务端；失败静默，本地记录已兜底
    // 每日挑战的整局上报已在 applyAuthoritativeDailyResult 完成，跳过以免重复
    if (MmaApi.isOnline() && options.skipSubmit !== true) {
        MmaApi.submitGame(buildGamePayload()).catch(() => {});
    }
}

function buildGamePayload() {
    return {
        mode: state.mode,
        region: state.mode === 'region' ? state.region : null,
        totalScore: state.totalScore,
        rounds: state.history.map((h) => ({
            name: h.name,
            locationId: h.locationId != null ? h.locationId : null,
            distanceKm: h.distanceKm,
            score: h.score,
            imageId: h.imageId || null,
            xp: h.xp || 0,
            difficulty: h.difficulty || 1,
            guessLat: h.guessLat != null ? h.guessLat : null,
            guessLng: h.guessLng != null ? h.guessLng : null,
            answerLat: h.answerLat != null ? h.answerLat : null,
            answerLng: h.answerLng != null ? h.answerLng : null,
        })),
    };
}

// 服务端记录转为本地历史渲染所需的结构
function serverGameToLocal(game) {
    const cfg = MODES[game.mode];
    return {
        id: game.id,
        date: new Date(game.createdAt).toLocaleString('zh-CN', { hour12: false }),
        mode: game.mode,
        modeLabel: cfg ? cfg.label : game.mode,
        region: game.region,
        regionName: game.region ? REGION_NAMES[game.region] : null,
        totalScore: game.totalScore,
        maxScore: cfg && cfg.rounds !== Infinity ? cfg.rounds * MAX_SCORE : null,
        rounds: game.rounds,
    };
}

async function openHistory() {
    if (MmaApi.isOnline()) {
        try {
            const result = await MmaApi.getRecent(HIST_MAX);
            renderHistoryList(result.games.map(serverGameToLocal), true);
            $('history-overlay').classList.add('show');
            return;
        } catch (e) {
            /* 服务端异常时回落到本地记录 */
        }
    }
    renderHistoryList(loadHistory(), false);
    $('history-overlay').classList.add('show');
}

function closeHistory() {
    $('history-overlay').classList.remove('show');
}

function renderHistoryList(all, isRemote) {
    const list = $('history-list');
    ensureHistoryDeleteDelegation(list);
    if (all.length === 0) {
        list.innerHTML =
            '<div class="hist-empty">📭 暂无游戏记录<br><span style="font-size:12px">开始一局游戏后会自动记录</span></div>';
        return;
    }
    list.innerHTML = all
        .map((g, gi) => {
            const scoreStr = g.maxScore ? `${g.totalScore} / ${g.maxScore} 分` : `Lv. 总分 ${g.totalScore}`;
            const regionStr = g.regionName ? ' · ' + escapeHtml(g.regionName) : '';
            const roundsHTML = g.rounds
                .map((r, ri) => {
                    const distStr =
                        r.distanceKm == null
                            ? '超时'
                            : r.distanceKm < 1
                              ? Math.round(r.distanceKm * 1000) + 'm'
                              : r.distanceKm.toFixed(0) + 'km';
                    const mlyLink = r.imageId
                        ? `<a class="hr-mly" href="https://www.mapillary.com/app/?pKey=${encodeURIComponent(r.imageId)}" target="_blank" rel="noopener noreferrer">🗺️ 查看街景</a>`
                        : '';
                    return `<div class="hr">
                            <span class="hr-round">r${ri + 1}</span>
                            <span class="hr-name">${escapeHtml(r.name)}</span>
                            <span class="hr-dist">${distStr}</span>
                            <span class="hr-score">${r.score}分</span>
                            ${mlyLink}
                        </div>`;
                })
                .join('');
            // 删除记录经事件委托调用（dataset 传参避免拼入内联 onclick 的属性注入面）
            const deleteKey = isRemote ? g.id : gi;
            return `<div class="hist-game">
                    <div class="hg-head">
                        <span class="hg-mode">${escapeHtml(g.modeLabel)}${regionStr}</span>
                        <span class="hg-date">${escapeHtml(g.date)}</span>
                    </div>
                    <span class="hg-score">${scoreStr}</span>
                    <div class="hist-rounds">${roundsHTML}</div>
                    <div style="text-align:right;margin-top:6px">
                        <button class="hist-delete" data-key="${escapeHtml(String(deleteKey))}" data-remote="${isRemote ? '1' : '0'}">🗑 删除</button>
                    </div>
                </div>`;
        })
        .join('');
}

let historyDelegationReady = false;

// 删除按钮事件委托：innerHTML 每次重建，仅需绑定一次容器监听
function ensureHistoryDelegation(list) {
    if (historyDelegationReady) return;
    historyDelegationReady = true;
    list.addEventListener('click', (event) => {
        const button = event.target.closest('.hist-delete');
        if (!button) return;
        const key = button.dataset.key;
        const remote = button.dataset.remote === '1';
        deleteHistory(key, remote);
    });
}

async function deleteHistory(key, isRemote) {
    if (!confirm('确定删除这条游戏记录吗？')) return;
    if (isRemote) {
        try {
            await MmaApi.deleteGame(key);
            openHistory();
        } catch (e) {
            showToast('❌ 删除失败，请稍后再试');
        }
        return;
    }
    const all = loadHistory();
    const localIndex = Number(key);
    if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= all.length) return;
    all.splice(localIndex, 1);
    saveHistory(all);
    openHistory(); // 刷新面板
}

// ==========================================================
// 【初始化】
// ==========================================================
window.onload = function () {
    initGuessMap();
    // 后台建立游客会话；游戏流程不等待后端，离线时立即以本地模式呈现最佳成绩
    MmaApi.init().finally(renderBests);
};

function initGuessMap() {
    map = L.map('guess-map', { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(map);
    map.on('click', function (e) {
        if (isSubmitting || state.finished) return;
        if (guessMarker) map.removeLayer(guessMarker);
        guessMarker = L.marker(e.latlng, { icon: redIcon }).addTo(map);
        guessPoint = e.latlng;
        $('submit-btn').disabled = false;
    });
}

// ==========================================================
// 【模式选择 / 启动】
// ==========================================================
// 每日挑战题单：由 daily.js 拉取 /api/daily/today 后注入，daily 模式固定使用该题单
let dailyChallenge = { date: null, locations: [] };
function startDailyChallenge(challenge) {
    dailyChallenge = { date: challenge.date, locations: challenge.locations };
    startGame('daily', null);
}

function chooseMode(mode) {
    if (mode === 'region') {
        $('region-screen').classList.add('show');
        return;
    }
    if (mode === 'daily') {
        openDailyPanel();
        return;
    }
    startGame(mode, null);
}
function hideRegionScreen() {
    $('region-screen').classList.remove('show');
}

function startGame(mode, region) {
    hideRegionScreen();
    state.mode = mode;
    state.region = region;
    state.round = 0;
    state.totalScore = 0;
    state.history = [];
    state.usedNames.clear();
    state.finished = false;
    state.drawKey = null;
    state.drawBag = [];
    state.endless = { level: 1, xp: 0, totalXp: 0, roundsPlayed: 0 };

    $('home-screen').style.display = 'none';
    $('game-container').classList.add('show');
    $('info-bar').classList.add('show');
    $('minimap-container').classList.add('show');
    $('submit-btn').classList.add('show');
    $('quit-btn').classList.add('show');

    const cfg = MODES[mode];
    $('mode-tag').textContent = cfg.label + (region ? ' · ' + REGION_NAMES[region] : '');
    $('total-score').textContent = '0';

    if (mode === 'endless') {
        $('round-info').innerHTML = '第 <span class="round" id="round-num">1</span> 题';
        $('level-panel').classList.add('show');
        updateLevelPanel();
    } else {
        $('round-info').innerHTML =
            '第 <span class="round" id="round-num">1</span> 轮 / 共 <span id="total-rounds">' +
            cfg.rounds +
            '</span> 轮';
        $('level-panel').classList.remove('show');
    }
    // 【修复】地图容器刚从 display:none 变为可见，必须先让 Leaflet 重算尺寸，
    // 否则 flyTo 会在零尺寸地图上计算出 NaN 并抛异常，中断 loadRound
    setTimeout(() => {
        map.invalidateSize();
        loadRound();
    }, 150);

    // 中国模式：锁定地图范围到国境内，减少无效拖动；其他模式解除锁定
    if (mode === 'china') {
        map.setMaxBounds(CHINA_BOUNDS);
        map.setMinZoom(3);
        safeFly(
            () => map.flyTo(CHINA_CENTER, 4, { duration: 0.8 }),
            () => map.setView(CHINA_CENTER, 4, { animate: false })
        );
    } else {
        map.setMaxBounds(null);
        map.setMinZoom(2);
    }
}

function quitGame() {
    if (state.mode === 'endless' && state.endless.roundsPlayed > 0) {
        stopTimer();
        showFinalScore();
        return;
    }
    if (confirm('确定退出本局游戏吗？当前进度将丢失。')) backHome();
}

function backHome() {
    stopTimer();
    state.finished = true;
    $('result-overlay').classList.remove('show');
    $('game-container').classList.remove('show');
    $('info-bar').classList.remove('show');
    $('minimap-container').classList.remove('show');
    $('submit-btn').classList.remove('show');
    $('quit-btn').classList.remove('show');
    $('timer-box').classList.remove('show');
    $('home-screen').style.display = 'flex';
    clearMapLayers();
    renderBests();
}

// ==========================================================
// 【出题：选地点 + 搜索 Mapillary 街景】
// ==========================================================
function currentDifficulty() {
    // 无限模式：等级越高难度越大 (Lv1-2→★1, 3-4→★2, 5-6→★3, 7-8→★4, 9+→★5)
    return Math.min(5, Math.ceil(state.endless.level / 2));
}

// ==========================================================
// 【题库隔离（v1.14.0）】
// 中国模式与其他模式题库完全隔离：
// · 中国模式 → 仅从 CHINA_LOCATIONS 抽题
// · 世界模式(经典/挑战/无限) → WORLD_LOCATIONS + 抽样中国题(占比 ≤20%)
// · 亚洲区域 → 亚洲非中国题 + 抽样中国题(占比 ≤20%)；其他大洲 → 纯本洲题

// 确定性均匀抽样（按难度均匀分布），保证中国题占比 ≤ 20%
function sampleChinaFrom(list, n) {
    if (n <= 0) return [];
    if (n >= list.length) return list.slice();
    // 按难度分组，每难度按比例抽取，维持难度分布
    const byDiff = {};
    list.forEach((l) => {
        (byDiff[l.difficulty] = byDiff[l.difficulty] || []).push(l);
    });
    const diffs = Object.keys(byDiff).sort((a, b) => a - b);
    const out = [];
    const total = list.length;
    let used = 0;
    for (const d of diffs) {
        const sub = byDiff[d];
        const cnt = Math.round((sub.length / total) * n);
        if (cnt <= 0) continue;
        const step = sub.length / cnt;
        for (let i = 0; i < cnt && used < n; i++) {
            out.push(sub[Math.floor(i * step)]);
            used++;
        }
    }
    // 若按比例取整后不足 n，从头补充
    for (let i = 0; i < list.length && used < n; i++) {
        if (!out.includes(list[i])) {
            out.push(list[i]);
            used++;
        }
    }
    return out.slice(0, n);
}

// 题库 key：模式/区域/难度任一变化则重建牌堆，保证同难度内各地区均衡
function poolKeyFor() {
    if (state.mode === 'endless') return 'endless:' + currentDifficulty();
    if (state.mode === 'region') return 'region:' + state.region;
    if (state.mode === 'china') return 'china';
    if (state.mode === 'daily') return 'daily:' + dailyChallenge.date;
    return 'mode:' + state.mode;
}

// 构建当前模式/区域/难度对应的候选地点池
function buildPool() {
    let pool;
    if (state.mode === 'daily') {
        pool = dailyChallenge.locations.slice();
        if (!pool.length) pool = WORLD_LOCATIONS.slice();
    } else if (state.mode === 'endless') {
        const d = currentDifficulty();
        const world = WORLD_LOCATIONS.filter((l) => l.difficulty === d);
        const base = world.length ? world : WORLD_LOCATIONS.filter((l) => Math.abs(l.difficulty - d) <= 1);
        const cn = CHINA_LOCATIONS.filter((l) => l.difficulty === d);
        const cnMax = Math.floor(base.length * 0.25); // 保证 cn/(base+cn) ≤ 20%
        pool = base.concat(sampleChinaFrom(cn, Math.min(cnMax, cn.length)));
    } else if (state.mode === 'region') {
        const diffs = MODES.region.diffPool;
        if (state.region === 'asia') {
            // 亚洲：非中国亚洲题 + 抽样中国题(≤20%)
            const world = LOCATIONS.filter(
                (l) => l.region === 'asia' && !l.name.startsWith('中国') && diffs.includes(l.difficulty)
            );
            const base = world.length
                ? world
                : LOCATIONS.filter((l) => l.region === 'asia' && !l.name.startsWith('中国'));
            const cn = CHINA_LOCATIONS.filter((l) => diffs.includes(l.difficulty));
            const cnMax = Math.floor(base.length * 0.25);
            pool = base.concat(sampleChinaFrom(cn, Math.min(cnMax, cn.length)));
        } else {
            pool = LOCATIONS.filter(
                (l) => l.region === state.region && !l.name.startsWith('中国') && diffs.includes(l.difficulty)
            );
            if (!pool.length) pool = LOCATIONS.filter((l) => l.region === state.region && !l.name.startsWith('中国'));
        }
    } else if (state.mode === 'china') {
        pool = CHINA_LOCATIONS.filter((l) => MODES.china.diffPool.includes(l.difficulty));
        if (!pool.length) pool = CHINA_LOCATIONS.slice();
    } else {
        // 经典 / 挑战：世界题 + 抽样中国题(≤20%)
        const diffs = MODES[state.mode].diffPool;
        const world = WORLD_LOCATIONS.filter((l) => diffs.includes(l.difficulty));
        const cn = CHINA_LOCATIONS.filter((l) => diffs.includes(l.difficulty));
        const cnMax = Math.floor(world.length * 0.25);
        pool = world.concat(sampleChinaFrom(cn, Math.min(cnMax, cn.length)));
    }
    return pool;
}

// Fisher–Yates 洗牌
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// 公平抽题：从洗牌牌堆顺序抽取，整副抽完才重洗，避免纯随机造成的地区聚集/重复
// roundTried：本轮已尝试过（街景未命中）的地点，本回合内不再重复尝试
function pickLocation(roundTried) {
    const key = poolKeyFor();
    if (state.drawKey !== key || !state.drawBag || state.drawBag.length === 0) {
        state.drawKey = key;
        state.drawBag = shuffle(buildPool().slice());
    }
    // 优先：本轮未试过 且 整局未用过
    for (let i = state.drawBag.length - 1; i >= 0; i--) {
        const loc = state.drawBag[i];
        if (roundTried && roundTried.has(loc.name)) continue;
        if (!state.usedNames.has(loc.name)) return loc;
    }
    // 兜底：本轮都试过，则接受整局用过但本轮未试的
    for (let i = state.drawBag.length - 1; i >= 0; i--) {
        const loc = state.drawBag[i];
        if (!(roundTried && roundTried.has(loc.name))) return loc;
    }
    return state.drawBag[state.drawBag.length - 1];
}

// 逐级扩大范围搜索街景；返回 { imageId, lat, lng }（lat/lng 是图片真实坐标，用于精确判分）
async function findMapillaryImage(lat, lng) {
    // Mapillary 对过大 bbox 直接报错(“reduce data”)，0.02/0.08 级无效；
    // 改为逐级 0.004/0.008/0.012（约 440m ~ 1.3km），提升港澳台等点位命中率
    const offsets = [0.004, 0.008, 0.012];
    const errLog = [];
    for (const offset of offsets) {
        const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
        const result = await searchStreetView(bbox, errLog, offset);
        if (result && result.data && result.data.length) {
            // 优先全景图，体验更好
            const panos = result.data.filter((i) => i.is_pano);
            const list = panos.length ? panos : result.data;
            const img = list[Math.floor(Math.random() * list.length)];
            const [ilng, ilat] = img.geometry.coordinates;
            return { imageId: img.id, lat: ilat, lng: ilng };
        }
        if (!result) continue;
        errLog.push(`bbox=${bbox} → 0 images`);
    }
    // 记录失败细节，供错误报告导出
    streetViewError = {
        stage: 'search',
        searchLog: errLog,
        targetLat: lat,
        targetLng: lng,
        offsets: offsets,
    };
    return null;
}

// 街景搜索：仅走服务端代理（密钥仅存于服务端，前端永不持有）。
// 代理不可达/失败时返回 null 并记录错误，由 panorama-fallback 兜底提示，不回退直连 Mapillary。
async function searchStreetView(bbox, errLog, offset) {
    try {
        const response = await fetch(
            `${API_BASE}/api/proxy/mapillary/search?bbox=${encodeURIComponent(bbox)}&limit=20`
        );
        if (response.ok) return await response.json();
        errLog.push(`proxy bbox=${bbox} → HTTP ${response.status}`);
    } catch (e) {
        errLog.push(`proxy bbox=${bbox} → 网络错误: ${e.message}`);
    }
    return null;
}

// 【修复】安全的地图视角切换：容器尺寸异常时 flyTo/flyToBounds 会抛 NaN 异常，
// 这里捕获并降级为无动画的 setView/fitBounds，保证不中断游戏流程
function safeFly(fn, fallback) {
    try {
        fn();
    } catch (e) {
        try {
            fallback();
        } catch (e2) {
            /* 忽略 */
        }
    }
}
function resetMapView(animate) {
    if (state.mode === 'region' && REGION_VIEWS[state.region]) {
        const b = REGION_VIEWS[state.region];
        safeFly(
            () => (animate ? map.flyToBounds(b, { duration: 1.0 }) : map.fitBounds(b)),
            () => map.fitBounds(b, { animate: false })
        );
    } else {
        safeFly(
            () => (animate ? map.flyTo([20, 0], 2, { duration: 1.0 }) : map.setView([20, 0], 2)),
            () => map.setView([20, 0], 2, { animate: false })
        );
    }
}

async function loadRound() {
    isSubmitting = true; // 【修复2】进入新回合先锁定，直到新街景答案就绪才解锁
    state.round++;
    $('round-num').textContent = state.round;
    $('submit-btn').disabled = true;
    $('submit-btn').textContent = '🎯 提交选择';
    clearMapLayers();
    guessPoint = null;

    // 【修复】先显示街景 loading 并开始搜索街景，地图动画放后面且加防护，
    // 避免地图异常阻断街景加载
    $('panorama-loading').style.display = 'flex';
    $('panorama-fallback').style.display = 'none';

    map.invalidateSize();
    resetMapView(true);

    // 选点 + 搜街景，最多尝试 4 个不同地点（本轮已尝试的不再重复）
    const roundTried = new Set();
    let found = null,
        loc = null;
    for (let i = 0; i < 4 && !found; i++) {
        loc = pickLocation(roundTried);
        roundTried.add(loc.name);
        if (state.mode === 'daily') {
            // 每日挑战由服务端下发题目，答案坐标绝不提前下发；直接用题单携带的图片标识渲染街景
            if (loc.mapillaryId) found = { imageId: loc.mapillaryId, panoramaUrl: null, lat: null, lng: null };
            else if (loc.panoramaUrl) found = { imageId: null, panoramaUrl: loc.panoramaUrl, lat: null, lng: null };
        } else {
            found = await findMapillaryImage(loc.lat, loc.lng);
        }
    }
    if (state.finished) return;

    if (!found) {
        $('panorama-loading').style.display = 'none';
        $('panorama-fallback').style.display = 'flex';
        return;
    }
    // 仅当街景成功加载、答案坐标确定后才“消费”该地点，避免无覆盖地点被白白消耗
    state.usedNames.add(loc.name);
    const bi = state.drawBag.indexOf(loc);
    if (bi >= 0) state.drawBag.splice(bi, 1);

    const imageId = found.imageId;
    const panoramaUrl = found.panoramaUrl || null;
    // 每日挑战的 lat/lng 保持 null：答案坐标仅在整局提交结算后由服务端回传
    state.current = {
        name: loc.name,
        lat: found.lat,
        lng: found.lng,
        difficulty: loc.difficulty,
        imageId,
        panoramaUrl,
        locationId: loc.id != null ? loc.id : null,
    };
    isSubmitting = false; // 【修复2】新街景答案就绪后才解锁交互，杜绝延迟窗口误判
    if (imageId) {
        showPanorama(imageId);
    } else {
        showPanoramaUrl(panoramaUrl);
    }
    showHint();
    startTimer();
}

function skipLocation() {
    $('panorama-fallback').style.display = 'none';
    state.round--;
    loadRound();
}

// ==========================================================
// 【360° 街景查看器（自研，走服务端代理）】
// v1.17.0 起移除 MapillaryJS：该库需客户端密钥才能直连 Mapillary。
// 改为经 /api/proxy/mapillary/image/:id 取 equirectangular 全景图，
// 用 three.js 球面渲染实现拖拽环视与滚轮/双指缩放，密钥永不下发浏览器。
// ==========================================================
const PANO_IMAGE_WIDTH = 2048;
const PANO_MIN_FOV = 30;
const PANO_MAX_FOV = 100;
const PANO_LOOK_SPEED = 0.005;
const PANO_SPHERE_RADIUS = 500;
const PANO_DEFAULT_FOV = 75;

let panoViewer = null; // { renderer, camera, sphere, animateId }

function showPanoramaFallback() {
    $('panorama-loading').style.display = 'none';
    $('panorama-fallback').style.display = 'flex';
}

function resizePanoViewer() {
    if (!panoViewer) return;
    const container = $('panorama-view');
    const width = container.clientWidth || container.offsetWidth || 800;
    const height = container.clientHeight || container.offsetHeight || 600;
    if (width <= 0 || height <= 0) return;
    panoViewer.camera.aspect = width / height;
    panoViewer.camera.updateProjectionMatrix();
    panoViewer.renderer.setSize(width, height);
}

function initPanoViewer() {
    const container = $('panorama-view');
    if (!container) return;
    const width = container.clientWidth || container.offsetWidth || 800;
    const height = container.clientHeight || container.offsetHeight || 600;

    const camera = new THREE.PerspectiveCamera(PANO_DEFAULT_FOV, width / height, 0.1, 1100);
    camera.rotation.order = 'YXZ';
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(PANO_SPHERE_RADIUS, 64, 48),
        new THREE.MeshBasicMaterial({ side: THREE.BackSide })
    );
    const scene = new THREE.Scene();
    scene.add(sphere);

    let isDragging = false;
    let prevX = 0;
    let prevY = 0;

    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        prevX = e.clientX;
        prevY = e.clientY;
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;
        camera.rotation.y -= dx * PANO_LOOK_SPEED;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x - dy * PANO_LOOK_SPEED));
    });
    window.addEventListener('mouseup', () => {
        isDragging = false;
    });
    container.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            camera.fov = Math.max(PANO_MIN_FOV, Math.min(PANO_MAX_FOV, camera.fov + e.deltaY * 0.05));
            camera.updateProjectionMatrix();
        },
        { passive: false }
    );
    container.addEventListener(
        'touchstart',
        (e) => {
            if (e.touches.length === 1) {
                isDragging = true;
                prevX = e.touches[0].clientX;
                prevY = e.touches[0].clientY;
            }
        },
        { passive: true }
    );
    window.addEventListener('touchmove', (e) => {
        if (!isDragging || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - prevX;
        const dy = e.touches[0].clientY - prevY;
        prevX = e.touches[0].clientX;
        prevY = e.touches[0].clientY;
        camera.rotation.y -= dx * PANO_LOOK_SPEED;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x - dy * PANO_LOOK_SPEED));
    });
    window.addEventListener('touchend', () => {
        isDragging = false;
    });

    let animateId = null;
    function animate() {
        animateId = requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', resizePanoViewer);
    panoViewer = { renderer, camera, sphere, animateId };
}

function setPanoImage(imageId) {
    if (!panoViewer) return;
    const url = `${API_BASE}/api/proxy/mapillary/image/${encodeURIComponent(imageId)}?width=${PANO_IMAGE_WIDTH}`;
    const texture = new THREE.TextureLoader().load(
        url,
        () => {
            $('panorama-loading').style.display = 'none';
        },
        undefined,
        () => {
            streetViewError = { stage: 'viewer', imageId: imageId, viewerError: '全景图加载失败' };
            showPanoramaFallback();
        }
    );
    texture.encoding = THREE.sRGBEncoding;
    panoViewer.sphere.material.map = texture;
    panoViewer.sphere.material.needsUpdate = true;
    panoViewer.camera.rotation.set(0, 0, 0);
    panoViewer.camera.fov = PANO_DEFAULT_FOV;
    panoViewer.camera.updateProjectionMatrix();
    resizePanoViewer();
}

function showPanorama(imageId) {
    $('panorama-loading').style.display = 'flex';
    $('panorama-fallback').style.display = 'none';
    try {
        if (!panoViewer) {
            initPanoViewer();
            // 容器刚由隐藏变为可见，尺寸就绪后再挂纹理，避免黑屏
            setTimeout(() => setPanoImage(imageId), 300);
        } else {
            setPanoImage(imageId);
        }
    } catch (e) {
        streetViewError = {
            stage: 'exception',
            imageId: imageId,
            viewerError: e && e.message ? e.message : String(e),
        };
        showPanoramaFallback();
    }
}

// 无街景 ID 时退化为直接展示全景图 URL（DOM 构建而非 innerHTML，避免 URL 注入）
function showPanoramaUrl(url) {
    if (!url) {
        showPanoramaFallback();
        return;
    }
    $('panorama-loading').style.display = 'none';
    $('panorama-fallback').style.display = 'none';
    const container = $('panorama-view');
    container.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '街景';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    container.appendChild(img);
}

function clearMapLayers() {
    if (guessMarker) {
        map.removeLayer(guessMarker);
        guessMarker = null;
    }
    if (answerMarker) {
        map.removeLayer(answerMarker);
        answerMarker = null;
    }
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
}

// ==========================================================
// 【街景加载错误报告导出】
// ==========================================================
function buildErrReportText() {
    const err = streetViewError || {};
    const round = state.current || {};
    const now = new Date();
    const lines = [];
    lines.push('═══ MmaGuessr 街景加载错误报告 ═══');
    lines.push(`版本      : ${VERSION}`);
    lines.push(`时间      : ${now.toLocaleString('zh-CN', { hour12: false })}`);
    lines.push(
        `模式      : ${MODES[state.mode] ? MODES[state.mode].label : state.mode}${state.region ? ' · ' + REGION_NAMES[state.region] : ''}`
    );
    lines.push(`轮次      : 第 ${state.round} 轮`);
    lines.push('');
    lines.push('【地点信息】');
    lines.push(`地点名称  : ${round.name || '未知'}`);
    lines.push(`答案坐标  : ${round.lat != null ? round.lat + ', ' + round.lng : '未知'}`);
    lines.push(`难度      : ${round.difficulty ? '★'.repeat(round.difficulty) : '未知'}`);
    lines.push('');
    lines.push('【街景 ID】');
    lines.push(`imageId   : ${round.imageId || err.imageId || '未获取'}`);
    lines.push('');
    lines.push('【错误状态】');
    lines.push(
        `错误阶段  : ${err.stage === 'search' ? '街景搜索失败（无覆盖或接口错误）' : err.stage === 'viewer' ? '街景查看器加载失败' : err.stage === 'exception' ? '异常抛出' : '未知'}`
    );
    if (err.searchLog && err.searchLog.length) {
        lines.push('搜索过程  :');
        err.searchLog.forEach((s) => lines.push(`    - ${s}`));
    }
    if (err.viewerError) lines.push(`查看器错误: ${err.viewerError}`);
    lines.push('');
    lines.push('【请求参数】');
    lines.push(`搜索偏移  : ${err.offsets ? err.offsets.join(', ') : '[0.004, 0.008, 0.012]'}`);
    lines.push(`API       : ${API_BASE}/api/proxy/mapillary/*`);
    lines.push('');
    lines.push('【浏览器环境】');
    lines.push(`UA        : ${navigator.userAgent}`);
    lines.push(`语言      : ${navigator.language}`);
    lines.push(
        `屏幕      : ${window.innerWidth}×${window.innerHeight} (${window.screen.width}×${window.screen.height})`
    );
    return lines.join('\n');
}
function showErrToast(msg) {
    const t = $('err-toast2');
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => (t.style.display = 'none'), 2000);
}
function exportStreetViewError() {
    const text = buildErrReportText();
    $('err-report-content').value = text;
    $('err-overlay').classList.add('show');
}
function closeErrReport() {
    $('err-overlay').classList.remove('show');
}
function downloadErrReport() {
    const text = $('err-report-content').value;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = URL.createObjectURL(blob);
    a.download = `mma-guessr-error-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 500);
    showErrToast('✅ 报告已下载');
}
function copyErrReport() {
    const text = $('err-report-content').value;
    navigator.clipboard &&
        navigator.clipboard
            .writeText(text)
            .then(() => showErrToast('✅ 已复制到剪贴板'))
            .catch(() => {
                const ta = $('err-report-content');
                ta.select();
                ta.setSelectionRange(0, ta.value.length);
                try {
                    document.execCommand('copy');
                    showErrToast('✅ 已复制到剪贴板');
                } catch (e) {
                    showErrToast('❌ 复制失败，请手动选择复制');
                }
            });
}

// ==========================================================
// 【倒计时（挑战模式）】
// ==========================================================
function startTimer() {
    stopTimer();
    const cfg = MODES[state.mode];
    if (!cfg.timer) {
        $('timer-box').classList.remove('show');
        return;
    }
    state.timeLeft = cfg.timer;
    $('timer-box').classList.add('show');
    $('timer-box').classList.remove('danger');
    $('timer-num').textContent = state.timeLeft;
    state.timerId = setInterval(() => {
        state.timeLeft--;
        $('timer-num').textContent = Math.max(0, state.timeLeft);
        if (state.timeLeft <= 10) $('timer-box').classList.add('danger');
        if (state.timeLeft <= 0) {
            stopTimer();
            if (guessPoint)
                submitGuess(); // 有标记 → 按当前标记结算
            else timeoutNoGuess(); // 没标记 → 0 分
        }
    }, 1000);
}
function stopTimer() {
    if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
    }
}

function timeoutNoGuess() {
    isSubmitting = true;
    const round = state.current;
    state.history.push({
        name: round.name,
        distanceKm: null,
        score: 0,
        difficulty: round.difficulty,
        xp: 0,
        locationId: round.locationId != null ? round.locationId : null,
        guessLat: null,
        guessLng: null,
        answerLat: round.lat,
        answerLng: round.lng,
    });
    // 每日挑战的答案坐标在结算前未知，超时回合不绘制答案标记
    if (round.lat != null && round.lng != null) {
        const targetLatLng = L.latLng(round.lat, round.lng);
        answerMarker = L.marker(targetLatLng, { icon: blueIcon }).addTo(map);
        safeFly(
            () => map.flyTo(targetLatLng, 5, { duration: 1.2 }),
            () => map.setView(targetLatLng, 5, { animate: false })
        );
    }

    $('new-record').style.display = 'none';
    $('result-title').textContent = '⏰ 时间到！';
    $('result-location').textContent = '📍 正确答案：' + round.name;
    $('result-distance').textContent = '未提交猜测';
    $('result-score').textContent = '+0 分';
    $('result-xp').style.display = 'none';
    $('score-bar-fill').style.width = '0%';
    setupNextButton();
    setTimeout(() => $('result-overlay').classList.add('show'), 1300);
}

// ==========================================================
// 【提交猜测 & 计分】
// ==========================================================
function calcScore(distanceKm) {
    // 指数衰减计分，采用分区参数系统：
    //   dMin 最小距离阈值——微调平滑，屏蔽像素级刷分
    //   α 平衡系数——替代旧"红场假点"缓冲方案
    //   各大洲/中国模式独立 D/α/dMin 参数
    const mode = state.mode;
    const region = state.region;

    let cfg;
    if (mode === 'china') {
        cfg = SCORE_CONFIG.china;
    } else if (mode === 'region' && region && SCORE_CONFIG.region[region]) {
        cfg = SCORE_CONFIG.region[region];
    } else {
        cfg = SCORE_CONFIG.global;
    }

    const dMinKm = cfg.dMin / 1000;
    const dEff = Math.max(distanceKm, dMinKm);
    const D_eff = cfg.D * cfg.α;
    let s = Math.round(MAX_SCORE * Math.exp((-10 * dEff) / D_eff));
    return Math.max(0, Math.min(MAX_SCORE, s));
}

function calcXp(score, difficulty) {
    // 无限模式经验：得分占比 × 100 × 难度系数（难度越大经验越多）
    const ratio = score / MAX_SCORE;
    const diffMult = 1 + (difficulty - 1) * 0.75; // ★1=1x, ★5=4x
    return Math.max(score > 0 ? 5 : 0, Math.round(ratio * 100 * diffMult));
}
function xpNeeded(level) {
    return 200 + (level - 1) * 150;
}

function submitGuess() {
    if (!guessPoint || isSubmitting) return;
    stopTimer();
    isSubmitting = true;
    $('submit-btn').disabled = true;
    $('submit-btn').textContent = '📏 测量中...';

    if (state.mode === 'daily') {
        completeDailyRound();
        return;
    }

    const round = state.current;
    const targetLatLng = L.latLng(round.lat, round.lng);
    const distanceKm = guessPoint.distanceTo(targetLatLng) / 1000;
    const score = calcScore(distanceKm);
    state.totalScore += score;
    state.history.push({
        name: round.name,
        distanceKm,
        score,
        imageId: round.imageId,
        difficulty: round.difficulty,
        locationId: round.locationId != null ? round.locationId : null,
        guessLat: guessPoint.lat,
        guessLng: guessPoint.lng,
        answerLat: round.lat,
        answerLng: round.lng,
    });

    // ---- 距离可视化：答案蓝点 + 虚线 + 飞行取景 ----
    answerMarker = L.marker(targetLatLng, { icon: blueIcon }).addTo(map);
    routeLine = L.polyline([guessPoint, targetLatLng], {
        color: '#ff4757',
        weight: 4,
        opacity: 0.9,
        dashArray: '8, 8',
        lineCap: 'round',
    }).addTo(map);
    const group = L.featureGroup([guessMarker, answerMarker]);
    safeFly(
        () => map.flyToBounds(group.getBounds().pad(0.4), { duration: 1.5, easeLinearity: 0.25 }),
        () => map.fitBounds(group.getBounds().pad(0.4), { animate: false })
    );

    // ---- 结果弹窗内容 ----
    $('new-record').style.display = 'none';
    $('result-title').textContent = '📊 本轮结果';
    $('result-location').textContent = '📍 正确答案：' + round.name;
    $('result-distance').textContent =
        distanceKm < 1 ? Math.round(distanceKm * 1000) + ' 米' : distanceKm.toFixed(distanceKm < 100 ? 2 : 0) + ' 公里';

    // 无限模式：结算经验 & 升级
    let xpGain = 0,
        leveledUp = false;
    if (state.mode === 'endless') {
        state.endless.roundsPlayed++;
        xpGain = calcXp(score, round.difficulty);
        state.endless.xp += xpGain;
        state.endless.totalXp += xpGain;
        while (state.endless.xp >= xpNeeded(state.endless.level)) {
            state.endless.xp -= xpNeeded(state.endless.level);
            state.endless.level++;
            leveledUp = true;
        }
        // 回合经验随成绩上报，供服务端还原无限模式的累计经验展示
        const lastRound = state.history[state.history.length - 1];
        if (lastRound) lastRound.xp = xpGain;
        $('result-xp').style.display = 'block';
        $('result-xp').textContent = `✨ +${xpGain} 经验（难度 ${'★'.repeat(round.difficulty)}）`;
    } else {
        $('result-xp').style.display = 'none';
    }

    setupNextButton();

    // ---- 延迟弹窗：先欣赏地图飞行与红线 ----
    setTimeout(() => {
        $('result-overlay').classList.add('show');
        // 得分数字滚动动画 + 进度条动画
        animateNumber($('result-score'), 0, score, 1200, (v) => '+' + v + ' 分');
        animateNumber($('total-score'), state.totalScore - score, state.totalScore, 1200, (v) => v);
        requestAnimationFrame(() => {
            $('score-bar-fill').style.width = (score / MAX_SCORE) * 100 + '%';
        });
        if (state.mode === 'endless') {
            updateLevelPanel();
            if (leveledUp) showLevelUp(state.endless.level);
        }
    }, 2200);
}

// 每日挑战单轮提交：答案坐标仅由服务端在整局结算后回传，本地只记录猜测点，不做距离/得分展示
function completeDailyRound() {
    const round = state.current;
    state.history.push({
        name: round.name,
        distanceKm: null,
        score: 0,
        imageId: round.imageId,
        difficulty: round.difficulty,
        locationId: round.locationId != null ? round.locationId : null,
        guessLat: guessPoint.lat,
        guessLng: guessPoint.lng,
        answerLat: null,
        answerLng: null,
    });

    $('new-record').style.display = 'none';
    $('result-title').textContent = '✅ 选点已提交';
    $('result-location').textContent = '📍 答案与得分将在挑战全部完成后揭晓';
    $('result-distance').textContent = '继续完成剩余题目';
    $('result-score').textContent = '🎯 保留悬念';
    $('result-xp').style.display = 'none';
    setupNextButton();
    setTimeout(() => $('result-overlay').classList.add('show'), 600);
}

function setupNextButton() {
    const cfg = MODES[state.mode];
    const isLast = state.mode !== 'endless' && state.round >= cfg.rounds;
    $('next-btn').textContent = isLast ? '🏁 查看总成绩' : state.mode === 'endless' ? '下一题 ▶' : '下一轮 ▶';
    $('next-btn').style.display = 'inline-block';
    $('share-btn').style.display = 'none';
    $('home-btn2').style.display = 'none';
    $('round-summary').style.display = 'none';
    $('next-btn').onclick = nextRound;
}

function nextRound() {
    $('result-overlay').classList.remove('show');
    const cfg = MODES[state.mode];
    if (state.mode !== 'endless' && state.round >= cfg.rounds) {
        showFinalScore();
        return;
    }
    loadRound();
}

// ==========================================================
// 【游戏结束：总结 / 记录 / 分享】
// ==========================================================
// 每日挑战整局结算：提交所有猜测点，服务端权威计算各轮距离/得分并回传，客户端不得提前知晓答案坐标
async function applyAuthoritativeDailyResult() {
    if (!MmaApi.isOnline()) {
        return;
    }
    try {
        const result = await MmaApi.submitGame(buildGamePayload());
        const serverGame = result && result.game ? result.game : null;
        if (serverGame === null) {
            return;
        }
        state.totalScore = serverGame.totalScore;
        state.history = state.history.map((history, index) => {
            const verified = serverGame.rounds[index];
            if (verified === undefined) {
                return history;
            }
            return {
                ...history,
                distanceKm: verified.distanceKm,
                score: verified.score,
                answerLat: verified.answerLat ?? null,
                answerLng: verified.answerLng ?? null,
            };
        });
    } catch (e) {
        showToast('成绩同步失败，请刷新后重试');
    }
}

function renderRoundSummary() {
    const sum = $('round-summary');
    sum.innerHTML = state.history
        .map(
            (h, i) =>
                `<div class="row"><span>R${i + 1} · ${escapeHtml(h.name)}</span><span>${formatDistanceShort(h.distanceKm)} · <span class="pts">${h.score == null ? 0 : h.score}分</span></span></div>`
        )
        .join('');
    sum.style.display = state.history.length ? 'block' : 'none';
}

function formatDistanceShort(distanceKm) {
    if (distanceKm == null) return '超时';
    return distanceKm < 1 ? Math.round(distanceKm * 1000) + 'm' : distanceKm.toFixed(0) + 'km';
}

async function showFinalScore() {
    state.finished = true;
    stopTimer();
    let isRecord = false;

    $('score-bar-fill').style.width = '0%';
    $('result-xp').style.display = 'none';

    if (state.mode === 'endless') {
        const e = state.endless;
        isRecord = saveBestIfHigher(
            'endless',
            { level: e.level, totalXp: e.totalXp, rounds: e.roundsPlayed, date: Date.now() },
            'totalXp'
        );
        $('result-title').textContent = '♾️ 无限模式结算';
        $('result-location').textContent = `共挑战 ${e.roundsPlayed} 题 · 总分 ${state.totalScore}`;
        $('result-distance').textContent = 'Lv.' + e.level;
        $('result-score').textContent = '累计 ' + e.totalXp + ' 经验';
    } else {
        if (state.mode === 'daily') {
            await applyAuthoritativeDailyResult();
        }
        const maxPossible = MODES[state.mode].rounds * MAX_SCORE;
        const pct = maxPossible ? (state.totalScore / maxPossible) * 100 : 0;
        const rank =
            pct >= 90
                ? '🏆 地理大师！'
                : pct >= 70
                  ? '🌟 旅行达人！'
                  : pct >= 50
                    ? '👍 还不错！'
                    : pct >= 30
                      ? '📚 继续学习~'
                      : '🌍 下次更好！';
        isRecord = saveBestIfHigher(
            state.mode,
            { score: state.totalScore, region: state.region, date: Date.now() },
            'score'
        );
        $('result-title').textContent = '🎮 游戏结束！' + MODES[state.mode].label;
        $('result-location').textContent = state.region
            ? '区域：' + REGION_NAMES[state.region]
            : '共 ' + state.history.length + ' 轮完成';
        $('result-distance').textContent = state.totalScore + ' / ' + maxPossible + ' 分';
        $('result-score').textContent = rank;
    }

    renderRoundSummary();
    $('new-record').style.display = isRecord ? 'inline-block' : 'none';
    $('next-btn').style.display = 'none';
    $('share-btn').style.display = 'inline-block';
    $('home-btn2').style.display = 'inline-block';
    $('result-overlay').classList.add('show');
    // 每日挑战已在 applyAuthoritativeDailyResult 中完成上报，此处避免重复提交
    saveGameHistory({ skipSubmit: state.mode === 'daily' });
}

function buildShareText() {
    const modeLabel = MODES[state.mode].label + (state.region ? '·' + REGION_NAMES[state.region] : '');
    let text = `🌍 MmaGuessr ${modeLabel}\n`;
    if (state.mode === 'endless') {
        text += `♾️ 挑战 ${state.endless.roundsPlayed} 题，达到 Lv.${state.endless.level}，累计 ${state.endless.totalXp} 经验！\n`;
    } else {
        text += `🏆 总分 ${state.totalScore} / ${state.history.length * MAX_SCORE}\n`;
    }
    state.history.slice(0, 8).forEach((h, i) => {
        const em = h.score >= 4500 ? '🟩' : h.score >= 3000 ? '🟨' : h.score >= 1500 ? '🟧' : '🟥';
        text += `${em} R${i + 1} ${h.distanceKm == null ? '超时' : h.distanceKm < 1 ? Math.round(h.distanceKm * 1000) + 'm' : h.distanceKm.toFixed(0) + 'km'} +${h.score}\n`;
    });
    text += '你也来挑战吧！';
    return text;
}

async function shareResult() {
    const text = buildShareText();
    if (navigator.share) {
        try {
            await navigator.share({ title: 'MmaGuessr 成绩', text });
            return;
        } catch (e) {
            /* 用户取消则降级复制 */
        }
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast('✅ 成绩已复制到剪贴板，快去分享吧！');
    } catch (e) {
        // 最后兜底
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('✅ 成绩已复制到剪贴板！');
    }
}

// ==========================================================
// 【UI 辅助：动画 / 提示】
// ==========================================================
function animateNumber(el, from, to, duration, fmt) {
    const start = performance.now();
    function frame(now) {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = fmt(Math.round(from + (to - from) * eased));
        if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function updateLevelPanel() {
    const e = state.endless;
    $('level-num').textContent = e.level;
    $('xp-num').textContent = e.xp;
    $('xp-need').textContent = xpNeeded(e.level);
    $('xp-bar-fill').style.width = Math.min(100, (e.xp / xpNeeded(e.level)) * 100) + '%';
    const d = currentDifficulty();
    $('diff-stars').textContent = '难度 ' + '★'.repeat(d) + '☆'.repeat(5 - d);
}

function showLevelUp(level) {
    $('levelup-num').textContent = level;
    $('levelup-toast').classList.add('show');
    setTimeout(() => $('levelup-toast').classList.remove('show'), 2200);
}

function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => (t.style.display = 'none'), 2500);
}

function toggleMapSize() {
    const container = $('minimap-container');
    const btn = $('map-toggle-btn');
    isMapEnlarged = !isMapEnlarged;
    container.classList.toggle('enlarged', isMapEnlarged);
    btn.textContent = isMapEnlarged ? '✕' : '⛶';
    setTimeout(() => map.invalidateSize(), 350);
}

/* 移动端：展开/收起小地图 */
function toggleMobileMap() {
    const mc = $('minimap-container');
    const btn = $('mobile-map-btn');
    const isOpen = mc.classList.toggle('mobile-open');
    btn.textContent = isOpen ? '✕ 收起地图' : '🗺️ 地图';
    if (isOpen) setTimeout(() => map.invalidateSize(), 300);
}

function showHint() {
    const hint = $('hint-text');
    hint.style.display = 'block';
    setTimeout(() => (hint.style.display = 'none'), 3000);
}

// 启动：渲染版本号到标题与界面
renderVersion();
