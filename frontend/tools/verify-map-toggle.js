#!/usr/bin/env node
'use strict';
/**
 * 地图显隐（CSS 层叠）回归验证 —— 无需浏览器即可确认「地图关不关得掉」。
 *
 * 背景：小地图的显隐由多组 class + 媒体查询 + !important 共同决定，极易出现
 * 「看起来加了收起规则、实际被更高特异性的展开规则压掉」。这类问题在真实设备上
 * 才暴露，且难以复现排查（issue #4：手机端地图展开后关不掉）。
 *
 * 做法：用 prettier 自带的 CSS 解析器拿到权威 AST（正确识别 @media 嵌套与规则边界），
 * 再按 CSS 层叠规则（!important > 特异性 > 定义顺序）求解每个
 * 「视口 × class 组合」下 #minimap-container 的最终 display，并断言 z-index 层级。
 *
 * 用法：
 *   cd frontend && node tools/verify-map-toggle.js
 * 退出码：0 全部通过；1 有场景失败（可直接接入 CI 做回归门禁）
 *
 * 改动 style.css 里小地图相关规则、或增删 .mobile-open / .map-collapsed 时务必重跑。
 */
const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const ROOT = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'src', 'css', 'style.css');
const TARGET = '#minimap-container';
const css = fs.readFileSync(CSS_PATH, 'utf8');

/** 极简特异性：id×100 + class×10（本项目选择器不含元素/伪类，够用） */
function specificity(selector) {
    const ids = (selector.match(/#/g) || []).length;
    const classes = (selector.match(/\./g) || []).length;
    return ids * 100 + classes * 10;
}

/** 从规则源码里取 display 值与是否 !important */
function readDisplay(bodyText) {
    const i = bodyText.indexOf('display');
    if (i < 0) return null;
    const colon = bodyText.indexOf(':', i);
    if (colon < 0) return null;
    let rest = bodyText.slice(colon + 1);
    const semi = rest.indexOf(';');
    if (semi >= 0) rest = rest.slice(0, semi);
    return { value: rest.replace('!important', '').trim(), important: rest.indexOf('!important') >= 0 };
}

/** 收集目标元素的所有 display 规则（含所在媒体查询条件） */
function collectRules(ast) {
    const rules = [];

    function walk(nodes, media) {
        (nodes || []).forEach((node) => {
            if (node.type === 'css-atrule' && node.name === 'media') {
                const src = css.slice(node.source.startOffset, node.source.endOffset);
                walk(node.nodes, src.slice(0, src.indexOf('{')).trim());
                return;
            }
            if (node.type !== 'css-rule') return;

            const text = css.slice(node.source.startOffset, node.source.endOffset);
            const braceIdx = text.indexOf('{');
            if (braceIdx < 0) return;
            const selectorText = text.slice(0, braceIdx);
            if (selectorText.indexOf(TARGET) < 0) return;

            const disp = readDisplay(text.slice(braceIdx));
            if (!disp) return;

            selectorText.split(',').forEach((one) => {
                const sel = one.trim();
                if (sel.indexOf(TARGET) < 0) return;
                rules.push({
                    selector: sel,
                    display: disp.value,
                    important: disp.important,
                    specificity: specificity(sel),
                    order: node.source.startOffset,
                    media,
                });
            });
        });
    }

    walk(ast.nodes, null);
    return rules;
}

function selectorMatches(sel, classList) {
    const parts = sel.split('#')[1];
    if (!parts) return false;
    const segs = parts.split('.');
    if (segs[0] !== TARGET.slice(1)) return false;
    for (let k = 1; k < segs.length; k++) {
        if (classList.indexOf(segs[k]) < 0) return false;
    }
    return true;
}

/** 按层叠规则求解最终 display */
function resolveDisplay(rules, classList, viewport) {
    const active = rules.filter((rule) => {
        if (!selectorMatches(rule.selector, classList)) return false;
        if (!rule.media) return true;
        if (viewport === 'mobile') return rule.media.indexOf('max-width: 768px') >= 0;
        if (viewport === 'landscape') return rule.media.indexOf('orientation: landscape') >= 0;
        return false; // desktop：媒体查询均不生效
    });
    if (!active.length) return 'none';
    active.sort((a, b) => {
        if (a.important !== b.important) return a.important ? -1 : 1;
        if (a.specificity !== b.specificity) return b.specificity - a.specificity;
        return b.order - a.order;
    });
    return active[0].display;
}

/** 取某选择器的 z-index */
function zIndexOf(ast, predicate) {
    let found = null;
    function walk(nodes, inMedia) {
        (nodes || []).forEach((node) => {
            if (node.type === 'css-atrule' && node.nodes) return walk(node.nodes, node.name === 'media');
            if (node.type !== 'css-rule' || found !== null) return;
            const text = css.slice(node.source.startOffset, node.source.endOffset);
            const braceIdx = text.indexOf('{');
            const sel = text.slice(0, braceIdx).trim();
            if (!predicate(sel, inMedia)) return;
            const m = text.slice(braceIdx).match(/z-index\s*:\s*(\d+)/);
            if (m) found = Number(m[1]);
        });
    }
    walk(ast.nodes, false);
    return found;
}

const SCENARIOS = [
    ['PC · 对局中默认（仅 .show）', ['show'], 'desktop', 'block'],
    ['PC · 点 ✕ / 开关收起', ['show', 'map-collapsed'], 'desktop', 'none'],
    ['PC · 收起后再展开', ['show'], 'desktop', 'block'],
    ['移动端 · 初始（小地图默认隐藏）', [], 'mobile', 'none'],
    ['移动端 · 点「地图」展开', ['show', 'mobile-open'], 'mobile', 'block'],
    ['★移动端 · 展开后收起', ['show', 'mobile-open', 'map-collapsed'], 'mobile', 'none'],
    ['移动端 · 收起后再展开', ['show', 'mobile-open'], 'mobile', 'block'],
    ['横屏手机 · 展开', ['show', 'mobile-open'], 'landscape', 'block'],
    ['★横屏手机 · 展开后收起', ['show', 'mobile-open', 'map-collapsed'], 'landscape', 'none'],
];

prettier.__debug
    .parse(css, { parser: 'css' })
    .then((parsed) => {
        const ast = parsed.ast || parsed;
        const rules = collectRules(ast);

        console.log(`地图显隐层叠验证  (${path.relative(process.cwd(), CSS_PATH)})`);
        console.log(`收集到 ${rules.length} 条 ${TARGET} 的 display 规则\n`);

        let pass = 0;
        let fail = 0;

        SCENARIOS.forEach(([label, classList, viewport, expected]) => {
            const actual = resolveDisplay(rules, classList, viewport);
            const ok = actual === expected;
            console.log(`  ${ok ? '✓' : '✗'} ${label}  →  display: ${actual}`);
            ok ? pass++ : fail++;
        });

        const zMobileOpen = zIndexOf(ast, (sel, inMedia) => inMedia && sel.indexOf(`${TARGET}.mobile-open`) === 0);
        const zToggle = zIndexOf(ast, (sel) => sel === '#map-visibility-btn');
        const zClose = zIndexOf(ast, (sel) => sel === '#map-close-btn');

        console.log('\n层级：');
        console.log(
            `  ${TARGET}.mobile-open = ${zMobileOpen}  |  #map-visibility-btn = ${zToggle}  |  #map-close-btn = ${zClose}`
        );

        const okToggle = zToggle !== null && zMobileOpen !== null && zToggle > zMobileOpen;
        const okClose = zClose !== null && zClose > 800; // Leaflet 控件层为 800
        console.log(`  ${okToggle ? '✓' : '✗'} 外部开关层级高于展开的地图（否则点不到）`);
        console.log(`  ${okClose ? '✓' : '✗'} 地图内 ✕ 层级高于 Leaflet 控件层`);
        okToggle ? pass++ : fail++;
        okClose ? pass++ : fail++;

        console.log(`\n${fail ? '✗' : '✓'} 通过 ${pass} / ${pass + fail}`);
        process.exit(fail ? 1 : 0);
    })
    .catch((e) => {
        console.error('CSS 解析失败：', e.message);
        process.exit(1);
    });
