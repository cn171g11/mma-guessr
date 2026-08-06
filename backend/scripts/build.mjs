import { rmSync } from 'node:fs';
import path from 'node:path';

import { cliMain, hasCommand, npmRun, okLog, projectRoot, run, warnLog } from './helpers.mjs';

const DIST_DIR = path.join(projectRoot, 'dist');

function parseArgs(argv) {
    const tagFlagIndex = argv.indexOf('--tag');
    const isDockerBuild = argv.includes('--docker');
    const dockerTag =
        tagFlagIndex >= 0 && argv[tagFlagIndex + 1] ? argv[tagFlagIndex + 1] : 'mma-guessr-backend:latest';
    return { isDockerBuild, dockerTag };
}

function cleanDist() {
    rmSync(DIST_DIR, { recursive: true, force: true });
    okLog('已清理 dist/');
}

function buildWithTypeScript() {
    okLog('开始 TypeScript 编译…');
    npmRun(['run', 'build']);
}

function buildDockerImage(dockerTag) {
    if (!hasCommand('docker')) {
        warnLog('未检测到 docker，已跳过镜像构建');
        return;
    }
    okLog(`构建 Docker 镜像 ${dockerTag} …`);
    run('docker', ['build', '-t', dockerTag, '.'], { cwd: projectRoot });
    okLog(`Docker 镜像已构建：${dockerTag}`);
}

cliMain(() => {
    const { isDockerBuild, dockerTag } = parseArgs(process.argv.slice(2));
    cleanDist();
    buildWithTypeScript();
    if (isDockerBuild) {
        buildDockerImage(dockerTag);
    }
});
