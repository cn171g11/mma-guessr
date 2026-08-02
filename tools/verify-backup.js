const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const ROOT = 'E:/Desktop/geoguesser';
const SNAP = path.join(ROOT, 'backups', 'snapshots');
const TAGS = ['v1.0.0', 'v1.7.0', 'v1.8.0', 'v1.9.0', 'v1.9.1', 'v1.10.0', 'v1.11.0', 'v1.12.0', 'v1.13.0', 'v1.14.0', 'v1.15.0'];

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

let allOk = true;

for (const tag of TAGS) {
  const zipPath = path.join(SNAP, `${tag}.zip`);
  const errors = [];

  // 1) SHA256 校验
  const shaLines = fs.readFileSync(path.join(SNAP, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
  const expected = shaLines.find(l => l.endsWith(`${tag}.zip`));
  if (!expected) { errors.push('SHA256SUMS 中缺失条目'); }
  else {
    const expHash = expected.split(' ')[0];
    const actHash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    if (expHash !== actHash) errors.push(`SHA256 不匹配: 期望 ${expHash.slice(0,12)} 实际 ${actHash.slice(0,12)}`);
  }

  // 2) 文件数一致性（zip 内 vs git 树）
  const gitFiles = sh(`git ls-tree -r --name-only ${tag}`).split('\n').map(s => s.replace(/\r$/, '')).filter(Boolean);
  const pyScript = `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); p=sys.argv[2]; [print(n.replace(p+'/','')) for n in z.namelist() if not n.endswith('/')]`;
  const pyOut = execSync(`python -c ${JSON.stringify(pyScript)} ${JSON.stringify(zipPath)} ${JSON.stringify(tag)}`, { encoding: 'utf8' });
  const zipList = pyOut.split('\n').map(s => s.replace(/\r$/, '')).filter(Boolean);
  if (gitFiles.length !== zipList.length) {
    errors.push(`文件数不匹配: git=${gitFiles.length} zip=${zipList.length}`);
  } else {
    // 3) 文件列表一致性（排序比较）
    const gs = [...gitFiles].sort();
    const zs = [...zipList].sort();
    for (let i = 0; i < gs.length; i++) {
      if (gs[i] !== zs[i]) { errors.push(`文件列表不一致: ${gs[i]} vs ${zs[i]}`); break; }
    }
  }

  const status = errors.length === 0 ? '✅ 通过' : '❌ 失败';
  if (errors.length) allOk = false;
  console.log(`${tag.padEnd(8)} ${status}${errors.length ? ' — ' + errors.join('; ') : ''}`);
}

console.log(allOk ? '\n🎉 全部 11 个版本备份验证通过' : '\n⚠️ 存在验证失败项');
process.exit(allOk ? 0 : 1);
