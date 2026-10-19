#!/usr/bin/env node
'use strict';
/**
 * 固定题单回归校验（无网络、无浏览器依赖）
 *
 * 在 vm 沙箱里加载 config.js + data.js + game.js（注入 DOM / Leaflet 的最小桩），
 * 直接驱动 loadRound / swapQuestion，验证：
 *   1. 练习模式搜不到街景的题目会被剔除，题单长度与「共 N 轮」同步收缩（不会卡死 / 不会末轮重复）
 *   2. 每日挑战题单里没有图源的题目会被剔除（不会反复抽到同一道坏题）
 *   3. 练习 / 每日 / 图包模式关闭换题入口，经典等模式保持可用
 *
 * 任一断言失败即非零退出：
 *   node tools/verify-fixed-list.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const results = [];
function check(label, condition, detail) {
    results.push({ label, ok: Boolean(condition), detail });
}

function fakeElement() {
    const set = new Set();
    return {
        style: {},
        dataset: {},
        disabled: false,
        textContent: '',
        innerHTML: '',
        value: '',
        classList: {
            add: (c) => set.add(c),
            remove: (c) => set.delete(c),
            contains: (c) => set.has(c),
            toggle: (c, force) => {
                if (force === undefined) return set.has(c) ? (set.delete(c), false) : (set.add(c), true);
                force ? set.add(c) : set.delete(c);
                return Boolean(force);
            },
        },
        addEventListener() {},
        appendChild() {},
        remove() {},
    };
}

function mapStub() {
    return {
        on() {},
        setView() {},
        invalidateSize() {},
        eachLayer() {},
        removeLayer() {},
        addLayer() {},
        setMaxBounds() {},
        setMinZoom() {},
        flyTo() {},
        flyToBounds() {},
        fitBounds() {},
        getBounds: () => ({ pad: () => ({}) }),
    };
}

const elements = new Map();
const el = (id) => {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
};

const store = new Map();
const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    fetch: () => Promise.reject(new Error('offline')),
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    },
    window: {
        location: { protocol: 'https:', hostname: 'example.com' },
        addEventListener() {},
        matchMedia: () => ({ matches: false }),
    },
    document: {
        title: '',
        getElementById: el,
        querySelectorAll: () => [],
        createElement: () => fakeElement(),
        addEventListener() {},
        body: fakeElement(),
    },
    L: {
        map: mapStub,
        tileLayer: () => ({ addTo() {}, on() {} }),
        marker: () => ({ addTo: () => ({}) }),
        latLng: (lat, lng) => ({ lat, lng, distanceTo: () => 0 }),
        Icon: function Icon() {},
        divIcon: () => ({}),
        polyline: () => ({ addTo() {} }),
        featureGroup: () => ({ getBounds: () => ({ pad: () => ({}) }) }),
    },
    THREE: {},
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const context = vm.createContext(sandbox);
['src/js/config.js', 'src/js/data.js', 'src/js/game.js'].forEach((file) => {
    vm.runInContext(read(file), context, { filename: file });
});

// 街景渲染与提示在沙箱里无意义，用桩替换（只验证抽题 / 清单维护逻辑）
// shuffle 固定为恒等：pickLocation 从牌堆末尾取题，配合恒等洗牌后抽题顺序 = 数组倒序，断言才可确定
vm.runInContext(
    `map = L.map('guess-map'); // window.onload 在沙箱里不会触发，手动初始化地图桩
     shuffle = (arr) => arr;
     showPanorama = () => {};
     showPanoramaUrl = () => {};
     showTencentPanorama = () => {};
     showPanoramaFallback = () => { fallbackCount++; };
     showToast = (m) => { toasts.push(m); };
     var fallbackCount = 0;
     var toasts = [];`,
    context
);

const run = (code) => vm.runInContext(`(async () => { ${code} })()`, context);

function makeLocs(n, prefix) {
    return Array.from({ length: n }, (_, i) => ({
        name: `${prefix}-${i}`,
        lat: i,
        lng: i,
        difficulty: 3,
        region: 'asia',
    }));
}

(async () => {
    // ---------- 1. 练习模式：3 道搜不到街景 + 1 道可用（坏题排在末尾，会被优先抽到） ----------
    await run(`
        state.mode = 'practice';
        state.finished = false;
        state.round = 0;
        state.history = [];
        state.usedNames.clear();
        state.drawBag = [];
        state.drawKey = null;
        practiceChallenge = { key: 7, label: 'T', locations: [
            { name: 'good',  lat: 3, lng: 3, difficulty: 3, region: 'asia' },
            { name: 'bad-0', lat: 0, lng: 0, difficulty: 3, region: 'asia' },
            { name: 'bad-1', lat: 1, lng: 1, difficulty: 3, region: 'asia' },
            { name: 'bad-2', lat: 2, lng: 2, difficulty: 3, region: 'asia' },
        ] };
        findMapillaryImage = async (lat) => (lat === 3
            ? { imageId: 'IMG', panoramaUrl: null, lat, lng: lat, isPano: true }
            : null);
        await loadRound();
    `);
    const practiceLeft = vm.runInContext('practiceChallenge.locations.length', context);
    const practiceTotal = vm.runInContext("document.getElementById('total-rounds').textContent", context);
    const practicePicked = vm.runInContext('state.current && state.current.name', context);
    check('练习模式：无街景题目被剔除（4 → 1）', practiceLeft === 1, `剩余 ${practiceLeft}`);
    check('练习模式：「共 N 轮」同步收缩为 1', practiceTotal === '1', `total-rounds=${practiceTotal}`);
    check('练习模式：最终抽到可用题目 good', practicePicked === 'good', `当前=${practicePicked}`);

    // ---------- 2. 练习模式：全部无街景（不应死循环 / 抛错） ----------
    await run(`
        state.mode = 'practice';
        state.finished = false;
        state.round = 0;
        state.drawBag = [];
        state.drawKey = null;
        practiceChallenge = { key: 8, label: 'T', locations: [
            { name: 'x-0', lat: 10, lng: 10, difficulty: 3, region: 'asia' },
            { name: 'x-1', lat: 11, lng: 11, difficulty: 3, region: 'asia' },
            { name: 'x-2', lat: 12, lng: 12, difficulty: 3, region: 'asia' },
        ] };
        findMapillaryImage = async () => null;
        fallbackCount = 0;
        await loadRound();
    `);
    const drained = vm.runInContext('practiceChallenge.locations.length', context);
    const fellBack = vm.runInContext("document.getElementById('panorama-fallback').style.display", context);
    check(
        '练习模式：题单抽干后落到街景失败提示（无死循环、无抛错）',
        drained === 0 && fellBack === 'flex',
        `剩余 ${drained} / fallback=${fellBack}`
    );

    // ---------- 3. 每日挑战：缺图源的题目被剔除 ----------
    await run(`
        state.mode = 'daily';
        state.finished = false;
        state.round = 0;
        state.drawBag = [];
        state.drawKey = null;
        dailyChallenge = { date: '2026-10-19', locations: [
            { name: 'ok-1', lat: 2, lng: 2, difficulty: 3, region: 'asia', mapillaryId: 'M1', panoramaUrl: null },
            { name: 'ok-2', lat: 3, lng: 3, difficulty: 3, region: 'asia', mapillaryId: 'M2', panoramaUrl: null },
            { name: 'no-src', lat: 1, lng: 1, difficulty: 3, region: 'asia' },
        ] };
        await loadRound();
    `);
    const dailyLeft = vm.runInContext('dailyChallenge.locations.length', context);
    const dailyPicked = vm.runInContext('state.current && state.current.name', context);
    check('每日挑战：缺图源的题目被剔除（3 → 2）', dailyLeft === 2, `剩余 ${dailyLeft}`);
    check('每日挑战：抽到带图源的题目 ok-2', dailyPicked === 'ok-2', `当前=${dailyPicked}`);

    // ---------- 4. 换题入口：固定题单关闭，普通模式保留 ----------
    await run(`
        toasts = [];
        state.mode = 'practice';
        state.finished = false;
        isSubmitting = false;
        state.swapsUsed = 0;
        state.round = 3;
        swapQuestion();
    `);
    const swapBlocked = vm.runInContext('toasts.join("|")', context);
    const swapsUsed = vm.runInContext('state.swapsUsed', context);
    check(
        '练习模式：换题被拒绝且不消耗次数',
        /固定题单/.test(swapBlocked) && swapsUsed === 0,
        `toasts=${swapBlocked} swapsUsed=${swapsUsed}`
    );

    const modes = {};
    ['daily', 'pack', 'practice', 'classic', 'endless'].forEach((mode) => {
        modes[mode] = vm.runInContext(`state.mode = '${mode}'; isFixedListMode();`, context);
    });
    check(
        'isFixedListMode：daily/pack/practice 为真，classic/endless 为假',
        modes.daily && modes.pack && modes.practice && !modes.classic && !modes.endless,
        JSON.stringify(modes)
    );

    await run(`
        state.mode = 'practice';
        startGame('practice', null);
        practiceSwapHidden = !document.getElementById('swap-btn').classList.contains('show');
        startGame('classic', null);
        classicSwapShown = document.getElementById('swap-btn').classList.contains('show');
    `);
    const practiceSwapHidden = vm.runInContext('practiceSwapHidden', context);
    const classicSwapShown = vm.runInContext('classicSwapShown', context);
    check('startGame：练习模式不显示换题按钮', practiceSwapHidden === true, `hidden=${practiceSwapHidden}`);
    check('startGame：经典模式仍显示换题按钮', classicSwapShown === true, `shown=${classicSwapShown}`);

    // ---------- 输出 ----------
    let failed = 0;
    results.forEach((r) => {
        if (!r.ok) failed++;
        console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? '  →  ' + r.detail : ''}`);
    });
    console.log(`\n${failed ? '✗' : '✓'} 通过 ${results.length - failed} / ${results.length}`);
    process.exit(failed ? 1 : 0);
})();
