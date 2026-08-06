import { execSync } from 'node:child_process';

import { cliMain, hasCommand, okLog, projectRoot, run } from './helpers.mjs';

const LOCAL_IMAGE_TAG = 'mma-guessr-backend:latest';

function parseArgs(argv) {
    return {
        isLocal: argv.includes('--local'),
        isPush: argv.includes('--push'),
    };
}

function requireDocker() {
    if (!hasCommand('docker')) {
        throw new Error('未检测到 docker，请先安装 Docker Desktop 或使用 WSL 中的 Docker');
    }
}

function deriveRegistryImage() {
    const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: projectRoot,
        encoding: 'utf8',
    }).trim();
    const imageMatch = /(?:github\.com[:/]|ghcr\.io\/)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl);
    if (imageMatch === null) {
        throw new Error(`无法从 remote.origin.url 推断镜像名：${remoteUrl}`);
    }
    return `ghcr.io/${imageMatch[1]}/${imageMatch[2]}-backend`;
}

function deployDevDependencies() {
    requireDocker();
    okLog('使用 docker compose 启动开发依赖（PostgreSQL + Redis）…');
    run('docker', ['compose', 'up', '-d'], { cwd: projectRoot });
    okLog('开发依赖已启动');
}

function buildLocalImage() {
    requireDocker();
    okLog(`构建本地镜像 ${LOCAL_IMAGE_TAG} …`);
    run('docker', ['build', '-t', LOCAL_IMAGE_TAG, '.'], { cwd: projectRoot });
    okLog(`镜像已构建：${LOCAL_IMAGE_TAG}`);
}

function pushRegistryImage() {
    requireDocker();
    const registryImage = deriveRegistryImage();
    okLog(`构建并推送 ${registryImage}:latest …`);
    run('docker', ['build', '-t', registryImage, '.'], { cwd: projectRoot });
    run('docker', ['push', registryImage]);
    okLog('推送完成');
}

cliMain(() => {
    const { isLocal, isPush } = parseArgs(process.argv.slice(2));
    if (isLocal) {
        deployDevDependencies();
        return;
    }
    if (isPush) {
        pushRegistryImage();
        return;
    }
    buildLocalImage();
});
