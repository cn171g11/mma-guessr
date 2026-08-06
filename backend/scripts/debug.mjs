import { assertInfraReady, cliMain, ensureEnvFile, npmRun, okLog, run } from './helpers.mjs';

const DEFAULT_DEBUG_PORT = 9229;

function parseArgs(argv) {
    const portFlagIndex = argv.indexOf('--port');
    return {
        isSkipMigrate: argv.includes('--no-migrate'),
        debugPort: portFlagIndex >= 0 && argv[portFlagIndex + 1] ? argv[portFlagIndex + 1] : String(DEFAULT_DEBUG_PORT),
    };
}

function runMigrations() {
    okLog('执行数据库迁移…');
    npmRun(['run', 'db:migrate']);
}

function startWatchServer(debugPort) {
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    okLog(`启动调试服务（tsx watch + inspector :${debugPort}）…`);
    run(npxCommand, ['tsx', 'watch', `--inspect=${debugPort}`, 'src/index.ts']);
}

cliMain(async () => {
    const { isSkipMigrate, debugPort } = parseArgs(process.argv.slice(2));
    await assertInfraReady();
    ensureEnvFile();
    if (!isSkipMigrate) {
        runMigrations();
    }
    startWatchServer(debugPort);
});
