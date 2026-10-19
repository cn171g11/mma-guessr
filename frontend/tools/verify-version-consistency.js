#!/usr/bin/env node
'use strict';
/**
 * 版本一致性校验（无网络依赖）
 *
 * 前端有四处会写死版本号，任一处漏改都会出问题：
 *   · src/js/config.js       const VERSION = 'vX.Y.Z'（界面 / 错误报告实际读取）
 *   · src/sw.js              const CACHE_VERSION = 'X.Y.Z'（Service Worker 缓存键）
 *      —— 版本号不跟着升，老用户会一直命中旧缓存，拿到修复前的 JS/CSS
 *   · src/index.html         <title>（浏览器标签 / 无 JS 时可见）
 *   · src/index.html         #home-version 占位文案（首屏渲染前可见）
 *
 * 任一处不一致即非零退出，供 GitHub Actions 使用：
 *   node tools/verify-version-consistency.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'src', 'js', 'config.js');
const SW = path.join(ROOT, 'src', 'sw.js');
const INDEX = path.join(ROOT, 'src', 'index.html');

const errors = [];
const log = (...args) => console.log(...args);

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function pick(source, pattern, label) {
    const match = source.match(pattern);
    if (!match) {
        errors.push(`未能在 ${label} 中匹配到版本号`);
        return null;
    }
    return match[1];
}

const configSrc = read(CONFIG);
const swSrc = read(SW);
const indexSrc = read(INDEX);

const appVersion = pick(configSrc, /const VERSION = 'v(\d+\.\d+\.\d+)'/, 'src/js/config.js');
const cacheVersion = pick(swSrc, /const CACHE_VERSION = '(\d+\.\d+\.\d+)'/, 'src/sw.js');
const titleVersion = pick(indexSrc, /<title>[^<]*MmaGuessr v(\d+\.\d+\.\d+)/, 'src/index.html <title>');
const badgeVersion = pick(indexSrc, /id="home-version">版本 v(\d+\.\d+\.\d+)</, 'src/index.html #home-version');

log(`config.js VERSION      : ${appVersion ? 'v' + appVersion : '(未取到)'}`);
log(`sw.js CACHE_VERSION    : ${cacheVersion || '(未取到)'}`);
log(`index.html <title>     : ${titleVersion ? 'v' + titleVersion : '(未取到)'}`);
log(`index.html #home-version: ${badgeVersion ? 'v' + badgeVersion : '(未取到)'}`);

if (appVersion) {
    if (cacheVersion !== appVersion) {
        errors.push(
            `Service Worker 缓存版本不同步：sw.js 为 ${cacheVersion}，config.js 为 ${appVersion}（老用户会命中旧缓存）`
        );
    }
    if (titleVersion !== appVersion) {
        errors.push(`index.html <title> 版本不同步：${titleVersion} ≠ ${appVersion}`);
    }
    if (badgeVersion !== appVersion) {
        errors.push(`index.html #home-version 版本不同步：${badgeVersion} ≠ ${appVersion}`);
    }
}

if (errors.length) {
    errors.forEach((message) => log('❌ ' + message));
    process.exit(1);
}

log(`✅ 版本一致性校验通过（v${appVersion}）`);
