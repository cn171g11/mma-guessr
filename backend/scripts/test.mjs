import { existsSync } from 'node:fs';
import path from 'node:path';

import { assertInfraReady, cliMain, ensureEnvFile, npmRun, okLog, projectRoot } from './helpers.mjs';

const COVERAGE_PACKAGE = '@vitest/coverage-v8';

function parseArgs(argv) {
    return {
        isWatch: argv.includes('--watch'),
        isCoverage: argv.includes('--coverage'),
        isSkipMigrate: argv.includes('--no-migrate'),
    };
}

function assertCoverageSupport() {
    if (!existsSync(path.join(projectRoot, 'node_modules', COVERAGE_PACKAGE))) {
        throw new Error(`未安装 ${COVERAGE_PACKAGE}，请先执行：npm i -D ${COVERAGE_PACKAGE}`);
    }
}

function runMigrations() {
    okLog('执行数据库迁移…');
    npmRun(['run', 'db:migrate']);
}

function buildTestCommand(config) {
    const npmScript = config.isWatch ? 'test:watch' : 'test';
    const forwardedArgs = config.isCoverage ? ['--', '--coverage'] : [];
    return { npmScript, forwardedArgs };
}

function runTests(config) {
    if (config.isCoverage) {
        assertCoverageSupport();
    }
    const { npmScript, forwardedArgs } = buildTestCommand(config);
    okLog(`启动测试（${config.isWatch ? 'watch 模式' : '单次运行'}）…`);
    npmRun(['run', npmScript, ...forwardedArgs]);
    okLog('测试通过');
}

cliMain(async () => {
    const config = parseArgs(process.argv.slice(2));
    await assertInfraReady();
    ensureEnvFile();
    if (!config.isSkipMigrate) {
        runMigrations();
    }
    runTests(config);
});
