#!/usr/bin/env node
'use strict';
/** 向 src/js/data.js 的 LOCATIONS 数组追加一批中国街景（含港澳台，统一归类为中国）。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'src', 'js', 'data.js');

let src = fs.readFileSync(GAME, 'utf8');

const marker = 'const LOCATIONS =';
const start = src.indexOf(marker);
if (start < 0) throw new Error('LOCATIONS not found');
const open = src.indexOf('[', start);
let depth = 0,
    inStr = false,
    quote = '',
    esc = false,
    end = -1;
for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) {
        esc = false;
        continue;
    }
    if (c === '\\') {
        esc = true;
        continue;
    }
    if (c === '"' || c === "'" || c === '`') {
        if (!inStr) {
            inStr = true;
            quote = c;
        } else if (quote === c) {
            inStr = false;
            quote = '';
        }
        continue;
    }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') {
        depth--;
        if (depth === 0) {
            end = i;
            break;
        }
    }
}
if (end < 0) throw new Error('LOCATIONS not closed');

const newEntries = [
    { name: '中国北京·天安门广场', lat: 39.9055, lng: 116.3976, region: 'asia', difficulty: 1 },
    { name: '中国上海·外滩', lat: 31.2397, lng: 121.4905, region: 'asia', difficulty: 1 },
    { name: '中国西安·钟楼', lat: 34.2608, lng: 108.9455, region: 'asia', difficulty: 1 },
    { name: '中国杭州·西湖', lat: 30.2592, lng: 120.149, region: 'asia', difficulty: 1 },
    { name: '中国广州·广州塔', lat: 23.1066, lng: 113.3245, region: 'asia', difficulty: 1 },
    { name: '中国香港·维多利亚港', lat: 22.294, lng: 114.172, region: 'asia', difficulty: 1 },
    { name: '中国台北·台北101', lat: 25.0339, lng: 121.5646, region: 'asia', difficulty: 1 },
    { name: '中国成都·春熙路', lat: 30.657, lng: 104.081, region: 'asia', difficulty: 1 },
    { name: '中国重庆·解放碑', lat: 29.563, lng: 106.577, region: 'asia', difficulty: 2 },
    { name: '中国深圳·福田CBD', lat: 22.541, lng: 114.0579, region: 'asia', difficulty: 2 },
    { name: '中国南京·夫子庙', lat: 32.0295, lng: 118.795, region: 'asia', difficulty: 2 },
    { name: '中国武汉·黄鹤楼', lat: 30.5466, lng: 114.305, region: 'asia', difficulty: 2 },
    { name: '中国苏州·平江路', lat: 31.315, lng: 120.639, region: 'asia', difficulty: 2 },
    { name: '中国厦门·鼓浪屿', lat: 24.447, lng: 118.066, region: 'asia', difficulty: 2 },
    { name: '中国青岛·栈桥', lat: 36.058, lng: 120.316, region: 'asia', difficulty: 2 },
    { name: '中国天津·意式风情区', lat: 39.13, lng: 117.2, region: 'asia', difficulty: 2 },
    { name: '中国长沙·橘子洲', lat: 28.233, lng: 112.955, region: 'asia', difficulty: 2 },
    { name: '中国澳门·大三巴', lat: 22.197, lng: 113.543, region: 'asia', difficulty: 2 },
    { name: '中国大连·星海广场', lat: 38.879, lng: 121.6, region: 'asia', difficulty: 2 },
    { name: '中国昆明·滇池', lat: 24.95, lng: 102.7, region: 'asia', difficulty: 3 },
    { name: '中国哈尔滨·中央大街', lat: 45.775, lng: 126.618, region: 'asia', difficulty: 3 },
    { name: '中国桂林·漓江', lat: 25.273, lng: 110.29, region: 'asia', difficulty: 3 },
    { name: '中国丽江·古城', lat: 26.872, lng: 100.229, region: 'asia', difficulty: 3 },
    { name: '中国三亚·亚龙湾', lat: 18.219, lng: 109.658, region: 'asia', difficulty: 3 },
    { name: '中国拉萨·布达拉宫', lat: 29.6558, lng: 91.117, region: 'asia', difficulty: 4 },
    { name: '中国乌鲁木齐·国际大巴扎', lat: 43.826, lng: 87.616, region: 'asia', difficulty: 4 },
    { name: '中国敦煌·莫高窟', lat: 40.035, lng: 94.809, region: 'asia', difficulty: 4 },
    { name: '中国喀什·老城', lat: 39.47, lng: 75.99, region: 'asia', difficulty: 5 },
    { name: '中国漠河·北极村', lat: 53.47, lng: 122.37, region: 'asia', difficulty: 5 },
];

const block = newEntries
    .map(
        (e) =>
            '            { name: ' +
            JSON.stringify(e.name) +
            ', lat: ' +
            e.lat +
            ', lng: ' +
            e.lng +
            ', region: ' +
            JSON.stringify(e.region) +
            ', difficulty: ' +
            e.difficulty +
            ' }'
    )
    .join(',\n');

let inner = src.slice(open + 1, end);
inner = inner.replace(/,\s*$/, ''); // 去掉可能的尾随逗号
const newInner = inner + ',\n' + block;
const newSrc = src.slice(0, open) + '[' + newInner + ']' + src.slice(end + 1);
fs.writeFileSync(GAME, newSrc, 'utf8');

// 自校验：重新解析 LOCATIONS 计数
const m = newSrc.indexOf(marker);
const o = newSrc.indexOf('[', m);
let d = 0,
    is = false,
    q = '',
    e2 = false,
    en = -1;
for (let i = o; i < newSrc.length; i++) {
    const c = newSrc[i];
    if (e2) {
        e2 = false;
        continue;
    }
    if (c === '\\') {
        e2 = true;
        continue;
    }
    if (c === '"' || c === "'" || c === '`') {
        if (!is) {
            is = true;
            q = c;
        } else if (q === c) {
            is = false;
            q = '';
        }
        continue;
    }
    if (is) continue;
    if (c === '[') d++;
    else if (c === ']') {
        d--;
        if (d === 0) {
            en = i;
            break;
        }
    }
}
const arr = eval(newSrc.slice(o, en + 1));
const cn = arr.filter(
    (l) => (l.name || '').indexOf('中国') === 0 || ['香港', '澳门', '台北'].some((p) => (l.name || '').indexOf(p) === 0)
);
console.log('✅ 已插入', newEntries.length, '条中国街景');
console.log('   LOCATIONS 总数 :', arr.length);
console.log('   其中中国相关   :', cn.length);
