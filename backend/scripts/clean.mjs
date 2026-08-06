import { rmSync } from 'node:fs';
import path from 'node:path';

import { cliMain, npmRun, okLog, projectRoot, warnLog } from './helpers.mjs';

function parseArgs(argv) {
    return {
        isRemoveNodeModules: argv.includes('--all'),
        isClearNpmCache: argv.includes('--npm-cache'),
    };
}

function cleanBuildAndTestArtifacts() {
    const artifactPaths = [
        ['dist', '构建产物'],
        ['coverage', '覆盖率报告'],
        ['node_modules/.cache', '依赖缓存'],
        ['node_modules/.vite', 'Vite/Vitest 缓存'],
        ['node_modules/.vitest', 'Vitest 缓存'],
    ];
    for (const [relativePath, label] of artifactPaths) {
        const targetPath = path.join(projectRoot, relativePath);
        rmSync(targetPath, { recursive: true, force: true });
        okLog(`已清理 ${label}（${relativePath}）`);
    }
}

function removeNodeModules() {
    rmSync(path.join(projectRoot, 'node_modules'), { recursive: true, force: true });
    okLog('已删除 node_modules/（请重新执行 npm install）');
}

function clearNpmCache() {
    warnLog('清理全局 npm 缓存…');
    npmRun(['cache', 'clean', '--force']);
}

cliMain(() => {
    const { isRemoveNodeModules, isClearNpmCache } = parseArgs(process.argv.slice(2));
    cleanBuildAndTestArtifacts();
    if (isRemoveNodeModules) {
        removeNodeModules();
    }
    if (isClearNpmCache) {
        clearNpmCache();
    }
    okLog('清理完成');
});
