#!/usr/bin/env node
'use strict';
/**
 * MmaGuessr 数据统计后端（可选）
 * --------------------------------------------
 * 纯前端部署（GitHub Pages）默认使用浏览器 localStorage 本地统计；
 * 如需「全局多用户聚合统计」，可运行本服务并让前端通过 URL 参数接入：
 *
 *   启动:  node tools/stats-server.js            # 默认 0.0.0.0:8787
 *          node tools/stats-server.js --port 9000
 *
 *   接入:  打开游戏时 URL 追加 ?api=http://服务器IP:8787
 *          或 localStorage 设置 mma_stats_api = http://服务器IP:8787
 *
 * 数据表:
 *   access_log  — 访问记录 (ts/page/ref/vid/ip/ua)
 *   play_rounds — 游玩轮次 (ts/mode/region)
 *
 * 依赖: express + better-sqlite3（需 npm install express better-sqlite3）
 */
const path = require('path');
const fs = require('fs');

let app, Database;
try {
  app = require('express')();
  Database = require('better-sqlite3');
} catch (e) {
  console.error('❌ 缺少依赖，请先安装: npm install express better-sqlite3');
  process.exit(1);
}

const PORT = process.argv.includes('--port') ? parseInt(process.argv[process.argv.indexOf('--port') + 1], 10) : 8787;
const HOST = '0.0.0.0';
const DB_PATH = path.resolve(__dirname, '..', 'data', 'mma-stats.db');

// ---------- 初始化 SQLite ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS access_log (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    ts   INTEGER NOT NULL,
    page TEXT DEFAULT '',
    ref  TEXT DEFAULT '',
    vid  TEXT DEFAULT '',
    ip   TEXT DEFAULT '',
    ua   TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_access_ts ON access_log(ts);
  CREATE TABLE IF NOT EXISTS play_rounds (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,
    mode   TEXT DEFAULT '',
    region TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_rounds_ts ON play_rounds(ts);
`);

app.use(require('express').json({ limit: '64kb' }));

// ---------- 接口 ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'mma-stats-server', time: Date.now() });
});

// 记录访问
app.post('/api/visit', (req, res) => {
  const b = req.body || {};
  const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : (req.socket && req.socket.remoteAddress) || '';
  try {
    db.prepare('INSERT INTO access_log (ts, page, ref, vid, ip, ua) VALUES (?,?,?,?,?,?)')
      .run(
        Number(b.ts) || Date.now(),
        String(b.page || '').slice(0, 100),
        String(b.ref || '').slice(0, 300),
        String(b.vid || '').slice(0, 60),
        String(b.ip || ip || '').slice(0, 60),
        String(b.ua || '').slice(0, 200)
      );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 记录游玩轮次
app.post('/api/play', (req, res) => {
  const b = req.body || {};
  try {
    db.prepare('INSERT INTO play_rounds (ts, mode, region) VALUES (?,?,?)')
      .run(Number(b.ts) || Date.now(), String(b.mode || '').slice(0, 20), String(b.region || '').slice(0, 20));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 统计聚合（与前端本地计算口径一致）
app.get('/api/stats', (req, res) => {
  try {
    const range = String(req.query.range || 'all');
    const from = rangeBounds(range);
    const visits = db.prepare('SELECT ts, ref, ip, page FROM access_log WHERE ts >= ? ORDER BY ts DESC LIMIT 2000').all(from);
    const rounds = db.prepare('SELECT ts FROM play_rounds WHERE ts >= ?').all(from);
    const uvRows = db.prepare("SELECT DISTINCT vid FROM access_log WHERE ts >= ? AND vid != ''").all(from);
    const pv = visits.length;
    const uv = uvRows.length;
    const data = {
      ok: true, online: true,
      pv, uv,
      rounds: rounds.length,
      visitTrend: buildTrend(visits, from),
      roundTrend: buildTrend(rounds, from),
      recentVisits: visits.slice(0, 30).map(v => ({ ts: v.ts, ref: v.ref || '', ip: v.ip || '', page: v.page || '' }))
    };
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- 工具函数（与前端一致） ----------
function rangeBounds(range) {
  const now = new Date();
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === 'week') {
    const day = (now.getDay() + 6) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
  }
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (range === 'd7') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  if (range === 'd30') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();
  return 0;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildTrend(records, from) {
  const map = {};
  records.forEach(r => { const k = dayKey(r.ts); map[k] = (map[k] || 0) + 1; });
  const end = new Date();
  let start;
  if (from === 0) {
    const first = records.length ? new Date(records[records.length - 1].ts) : new Date();
    const span = Math.max(1, Math.ceil((end - first) / 86400000));
    if (span > 62) {
      const wk = {};
      records.forEach(r => {
        const d = new Date(r.ts);
        const y = d.getFullYear();
        const w = Math.ceil(((d - new Date(y, 0, 1)) / 86400000 + 1) / 7);
        const k = `${y}-W${String(w).padStart(2, '0')}`;
        wk[k] = (wk[k] || 0) + 1;
      });
      const ks = Object.keys(wk).sort();
      return { labels: ks.map(k => k.replace('W', '周')), counts: ks.map(k => wk[k]) };
    }
    start = first;
  } else {
    start = new Date(from);
  }
  const days = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, key: dayKey(d.getTime()), count: 0 });
  }
  days.forEach(dt => { dt.count = map[dt.key] || 0; });
  return { labels: days.map(d => d.label), counts: days.map(d => d.count) };
}

// ---------- 启动 ----------
app.listen(PORT, HOST, () => {
  console.log('✅ MmaGuessr 统计服务已启动');
  console.log(`   http://${HOST}:${PORT}/api/health`);
  console.log(`   接入方式: 游戏 URL 追加 ?api=http://你的IP:${PORT}`);
  console.log(`   数据库: ${DB_PATH}`);
});
