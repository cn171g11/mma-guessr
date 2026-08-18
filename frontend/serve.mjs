// MmaGuessr 本地前端开发服务器（零依赖，Node >= 18）
// 用法：
//   node serve.mjs                         # 原样输出 config.js（同源/本地开发）
//   node serve.mjs --api https://api.x.com  # 注入 API_BASE
//   node serve.mjs --secret <key>          # 注入 API_SIGNING_SECRET（与后端一致）
//   node serve.mjs --port 8080             # 自定义端口（默认 8080）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

const args = process.argv.slice(2);
const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const apiBase = opt('--api');
const signingSecret = opt('--secret');
const port = Number.parseInt(opt('--port') || process.env.PORT || '8080', 10);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
};

function patchConfig(raw) {
    let out = raw;
    if (apiBase !== undefined) {
        out = out.replace(/const API_BASE = .*?;/g, `const API_BASE = '${apiBase}';`);
    }
    if (signingSecret !== undefined) {
        out = out.replace(/const API_SIGNING_SECRET = '[^']*';/g, `const API_SIGNING_SECRET = '${signingSecret}';`);
    }
    return out;
}

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        let pathname = url.pathname;
        if (pathname === '/') pathname = '/index.html';

        if (pathname === '/src/js/config.js') {
            const raw = await readFile(join(ROOT, pathname.replace(/^\/+/, '')), 'utf8');
            const patched = await patchConfig(raw);
            res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
            res.end(patched);
            console.log(`${req.method} ${pathname} (patched config)`);
            return;
        }

        const decoded = decodeURIComponent(pathname).replace(/^[/\\]+/, '');
        const file = resolve(join(ROOT, decoded));
        if (!file.startsWith(ROOT + sep)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const data = await readFile(file);
        const ext = extname(file).toLowerCase();
        const isHtml = ext === '.html';
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
        });
        res.end(data);
        console.log(`${req.method} ${pathname}`);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            res.writeHead(404);
            res.end('404 Not Found');
        } else {
            res.writeHead(500);
            res.end('500 Internal Server Error');
            console.error(err);
        }
    }
}).listen(port, () => {
    console.log(`MmaGuessr frontend serving at http://localhost:${port}`);
    console.log(`root: ${ROOT}`);
    if (apiBase !== undefined) console.log(`API_BASE -> ${apiBase}`);
    if (signingSecret !== undefined) console.log('API_SIGNING_SECRET injected');
});