#!/usr/bin/env node
'use strict';
/**
 * 换题（重新抽取当前题目）回归验证 —— 无需浏览器即可确认接线、层级与次数规则。
 *
 * 覆盖三类只在真机/跨端才暴露、但可以静态或纯函数验证的缺陷：
 *   1. 接线断链：按钮 id、事件绑定、routeSwap → swapQuestion / mpRequestSwap、前后端事件名
 *      任意一处改名都会静默失效（点了没反应，控制台也不报错）；
 *   2. 按钮被遮挡：换题与提交都是 position:fixed 的右下角按钮，三套布局（默认 / 窄屏 /
 *      手机横屏）里换题的 bottom 必须高于提交的，否则两个按钮叠在一起点不到
 *      —— 同类问题见 issue #4「移动端地图关不掉」；
 *   3. 次数规则：单人对局换题机会由轮数推导（5 轮 3 次），改了 ratio / 上限就会悄悄变成
 *      每局无限刷题；冷却一旦丢失，换题就退化成「逐题刷到满意为止」。
 *
 * 用法：cd frontend && node tools/verify-swap.js
 * 退出码：0 全部通过；1 有断言失败（可接入 CI 做回归门禁）
 *
 * 改动 index.html 的 #swap-btn、style.css 里换题/提交按钮定位、或 game.js 的 swapBudget
 * 与 mp.js 的 mp:swap 事件时务必重跑。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r/g, '');

const html = read('src/index.html');
const css = read('src/css/style.css');
const events = read('src/js/events.js');
const game = read('src/js/game.js');
const mp = read('src/js/mp.js');
const config = read('src/js/config.js');
// 后端契约：换题事件必须两端同名，否则前端点了没反应
const service = read('../backend/internal/multiplayer/service.go');

const failures = [];
function check(name, ok, detail) {
    if (ok) {
        console.log('  ✅ ' + name);
        return;
    }
    console.log('  ❌ ' + name + (detail ? ' —— ' + detail : ''));
    failures.push(name);
}

// ---------------------------------------------------------- 1. 接线
console.log('【按钮接线】');
const htmlIds = html.match(/id="swap-btn"/g) || [];
check('index.html 有且仅有一个 #swap-btn', htmlIds.length === 1, 'found ' + htmlIds.length);
check('events.js 把 #swap-btn 绑定到 routeSwap', /bindClick\('#swap-btn',\s*routeSwap\)/.test(events));
check('game.js 定义 routeSwap', /function routeSwap\(\)/.test(game));
check('game.js 定义 swapQuestion', /function swapQuestion\(\)/.test(game));
check('game.js 定义 updateSwapButton', /function updateSwapButton\(\)/.test(game));
check('mp.js 定义 mpRequestSwap', /function mpRequestSwap\(\)/.test(mp));
check('game.js 的 routeSwap 在对战下转交 mpRequestSwap', /mpRequestSwap\(\)/.test(game));
check(
    'game.js 引用的 #swap-btn 存在于 index.html',
    /\$\('swap-btn'\)/.test(game) && !/id="swap-btn"/.test('') && htmlIds.length === 1
);

// ---------------------------------------------------------- 2. 前后端事件契约
console.log('【前后端事件契约】');
check('后端分发 mp:swap', /case "mp:swap":/.test(service));
check('后端处理 action=request', /case "request":/.test(service));
check('后端处理 action=accept', /case "accept":/.test(service));
check('后端处理 action=decline', /case "decline":/.test(service));
check('后端向对手推送 mp:swapRequested', service.includes('mp:swapRequested'));
check('后端向请求方回推 mp:swapDeclined', service.includes('mp:swapDeclined'));
check('前端订阅 mp:swapRequested', mp.includes("on('mp:swapRequested'"));
check('前端订阅 mp:swapDeclined', mp.includes("on('mp:swapDeclined'"));
const emits = (mp.match(/emit\('mp:swap'/g) || []).length;
check('前端发起 mp:swap（请求 + 同意/拒绝）', emits >= 2, 'emit 次数 ' + emits);
check('前端能表达同意与拒绝', mp.includes("'accept'") && mp.includes("'decline'"));
check('重抽标记 swapped 两端一致', service.includes('json:"swapped"') && /data\.swapped/.test(mp));
check('后端限制每人每回合只发起一次换题请求', /SwapAsked/.test(service) && /SwapAsked = false/.test(service));
check(
    '换题受「已提交 / 结算中」守卫',
    /anyAnswered\(current\)/.test(service) &&
        /\$\('result-overlay'\)\.classList\.contains\('show'\)/.test(mp) &&
        /mpState\.waitingResult \|\|/.test(mp)
);

// ---------------------------------------------------------- 3. 按钮定位（三套布局）
console.log('【按钮定位：换题不得压在提交按钮上】');
const firstMedia = css.indexOf('@media');
const baseSlice = css.slice(0, firstMedia < 0 ? css.length : firstMedia);

/** 取某媒体查询块（到下一个顶级 } 为止），返回 null 表示该块已不存在 */
function mediaSlice(header) {
    const start = css.indexOf(header);
    if (start < 0) return null;
    const end = css.indexOf('\n}', start);
    return css.slice(start, end < 0 ? css.length : end);
}

/** 从规则体里读 bottom 像素值 */
function bottomOf(text, selector) {
    const start = text.indexOf(selector + ' {');
    if (start < 0) return null;
    const body = text.slice(start, text.indexOf('}', start));
    const matched = body.match(/bottom:\s*(-?\d+)px/);
    return matched ? Number(matched[1]) : null;
}

const LAYOUTS = [
    ['默认布局', baseSlice],
    ['窄屏 (max-width: 768px)', mediaSlice('@media (max-width: 768px)')],
    [
        '手机横屏 (landscape and max-height: 500px)',
        mediaSlice('@media (orientation: landscape) and (max-height: 500px)'),
    ],
];
// 提交按钮高约 40px + 间距，换题的 bottom 至少高出一个按钮身位
const MIN_GAP_PX = 40;
LAYOUTS.forEach(([label, slice]) => {
    if (slice == null) {
        check(label + '：媒体查询块存在', false, '未找到该布局块');
        return;
    }
    const submitBottom = bottomOf(slice, '#submit-btn');
    const swapBottom = bottomOf(slice, '#swap-btn');
    if (submitBottom == null || swapBottom == null) {
        check(label + '：两个按钮都定位了', false, 'submit=' + submitBottom + ' swap=' + swapBottom);
        return;
    }
    check(
        label + '：换题在提交之上（' + swapBottom + ' > ' + submitBottom + ' + ' + MIN_GAP_PX + '）',
        swapBottom >= submitBottom + MIN_GAP_PX,
        'swapBottom=' + swapBottom + ' submitBottom=' + submitBottom
    );
});
check(
    '#swap-btn 默认隐藏',
    /display:\s*none/.test(css.slice(css.indexOf('#swap-btn {'), css.indexOf('}', css.indexOf('#swap-btn {'))))
);
check('#swap-btn.show 覆盖为显示（特异性更高）', /#swap-btn\.show\s*\{\s*display:\s*block/.test(css));
check('#swap-btn 有禁用态样式（次数用尽 / 已提交）', /#swap-btn:disabled\s*\{/.test(css));

// ---------------------------------------------------------- 4. 次数与冷却规则
console.log('【次数与冷却规则】');
/** 抽出函数/常量的源码，直接用真正的实现跑断言，避免复刻一份会漂移的逻辑 */
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) return null;
    const end = src.indexOf('\n}', start);
    return end < 0 ? null : src.slice(start, end + 2);
}
const cfgStart = config.indexOf('const SWAP_CONFIG = {');
const cfgEnd = config.indexOf('};', cfgStart);
const configSource = cfgStart < 0 || cfgEnd < 0 ? null : config.slice(cfgStart, cfgEnd + 2);
const budgetSource = extractFunction(game, 'swapBudget');
check('能取到 SWAP_CONFIG 与 swapBudget 源码', Boolean(configSource) && Boolean(budgetSource));

if (configSource && budgetSource) {
    const holder = { mode: 'challenge', rounds: 5 };
    const context = vm.createContext({ state: holder, roundsFor: () => holder.rounds });
    vm.runInContext(configSource + '\n' + budgetSource + '\nglobalThis.__budget = swapBudget;', context);
    const budget = (mode, rounds) => {
        holder.mode = mode;
        holder.rounds = rounds;
        return context.__budget();
    };
    const endlessPerLevel = vm.runInContext('SWAP_CONFIG.endlessPerLevel', context);
    const maxPerGame = vm.runInContext('SWAP_CONFIG.maxPerGame', context);
    const cooldownMs = vm.runInContext('SWAP_CONFIG.cooldownMs', context);

    check('5 轮 = 3 次换题机会（需求：5 题 3 次）', budget('challenge', 5) === 3, String(budget('challenge', 5)));
    check('5 轮区域模式同样是 3 次', budget('region', 5) === 3, String(budget('region', 5)));
    check('单轮模式至少给 1 次', budget('classic', 1) === 1, String(budget('classic', 1)));
    check('无限模式按每级发放', budget('endless', Infinity) === endlessPerLevel, String(budget('endless', Infinity)));
    check('长轮次模式不超过上限', budget('pack', 10) <= maxPerGame, String(budget('pack', 10)));
    check('冷却为正数', Number.isFinite(cooldownMs) && cooldownMs > 0, String(cooldownMs));
    check(
        '单人对局消耗次数并写入冷却',
        /state\.swapsUsed\+\+/.test(game) && /state\.swapReadyAt = Date\.now\(\) \+ SWAP_CONFIG\.cooldownMs/.test(game)
    );
    check('冷却未结束时不发放换题', /waitMs > 0/.test(game) && /swapReadyAt - Date\.now\(\)/.test(game));
    check('次数用尽后按钮禁用', /left <= 0/.test(game));
    check('每日挑战 / 图包不提供换题', /mode !== 'daily' && mode !== 'pack'/.test(game));
    check('换题不计入轮次（round-- 后再 loadRound）', /state\.round--;\s*loadRound\(\);/.test(game));
} else {
    check('能取到 SWAP_CONFIG 与 swapBudget 源码', false, '命名或写法已变更，需同步脚本');
}

// ---------------------------------------------------------- 5. 文档同步
console.log('【文档同步】');
const api = read('../docs/api.md');
check('docs/api.md 记录了 mp:swap 事件', api.includes('mp:swap'));
check('docs/api.md 记录了 mp:round 的 swapped 标记', api.includes('swapped'));
check('docs/api.md 记录了每人每回合一次的限制', /每人最多发起一次/.test(api));

// ---------------------------------------------------------- 结果
if (failures.length) {
    console.log('\n❌ 换题验证失败 ' + failures.length + ' 项：' + failures.join(' / '));
    process.exit(1);
}
console.log('\n✅ 换题验证通过');
