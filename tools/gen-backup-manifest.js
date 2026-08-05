const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = 'E:/Desktop/geoguesser';
const SNAP = path.join(ROOT, 'backups', 'snapshots');
const TAGS = [
    'v1.0.0',
    'v1.7.0',
    'v1.8.0',
    'v1.9.0',
    'v1.9.1',
    'v1.10.0',
    'v1.11.0',
    'v1.12.0',
    'v1.13.0',
    'v1.14.0',
    'v1.15.0',
];

function sh(cmd) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

let manifest = '';
let sha = '';
const rows = [];

for (const tag of TAGS) {
    const commit = sh(`git rev-list -n1 ${tag}`);
    const short = commit.slice(0, 7);
    const date = sh(`git log -1 --format=%ci ${tag}`).split(' ')[0];
    const msg = sh(`git log -1 --format=%s ${tag}`);
    // 文件数与文件列表
    const files = sh(`git ls-tree -r --name-only ${tag}`).split('\n').filter(Boolean);
    // zip SHA256
    const zipPath = path.join(SNAP, `${tag}.zip`);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    const size = fs.statSync(zipPath).size;
    rows.push({ tag, commit, short, date, msg, files, hash, size });
    sha += `${hash}  ${tag}.zip\n`;
}

// MANIFEST
manifest += `# MmaGuessr 多版本备份清单 (MANIFEST)\n\n`;
manifest += `> 生成时间: ${new Date().toISOString()}\n`;
manifest += `> 备份方式: git tag（远程）+ git archive 快照（本地 backups/snapshots/*.zip）\n`;
manifest += `> 每个 zip 均含对应版本工作树的完整文件（含新增/修改/删除后的最终状态）\n\n`;
manifest += `| 版本 | 提交 | 日期 | 文件数 | 快照大小 | SHA256（前12位） | 版本说明 |\n`;
manifest += `|------|------|------|--------|----------|------------------|----------|\n`;
for (const r of rows) {
    manifest += `| **${r.tag}** | \`${r.short}\` | ${r.date} | ${r.files.length} | ${(r.size / 1024).toFixed(1)} KB | \`${r.hash.slice(0, 12)}\` | ${r.msg} |\n`;
}

manifest += `\n## 版本文件明细\n`;
for (const r of rows) {
    manifest += `\n### ${r.tag} (${r.short}) — ${r.files.length} 个文件\n`;
    manifest += `\`\`\`\n${r.files.join('\n')}\n\`\`\`\n`;
}

fs.writeFileSync(path.join(SNAP, 'MANIFEST.md'), manifest, 'utf8');
fs.writeFileSync(path.join(SNAP, 'SHA256SUMS'), sha, 'utf8');
console.log('✅ MANIFEST.md 与 SHA256SUMS 已生成');
console.log('版本数:', rows.length);
rows.forEach((r) =>
    console.log(
        `  ${r.tag.padEnd(8)} ${r.short}  ${r.files.length} 文件  ${(r.size / 1024).toFixed(1)}KB  ${r.hash.slice(0, 12)}`
    )
);
