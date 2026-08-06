import { npmRun, okLog, cliMain } from './helpers.mjs';

const CHECK_STEPS = [
    ['类型检查', 'typecheck'],
    ['ESLint', 'lint'],
    ['Prettier 格式', 'format:check'],
];

function parseArgs(argv) {
    const isSkipFormat = argv.includes('--skip-format');
    return { isSkipFormat };
}

function runChecks(isSkipFormat) {
    const startedAt = Date.now();
    for (const [stepName, npmScript] of CHECK_STEPS) {
        if (isSkipFormat && npmScript === 'format:check') {
            continue;
        }
        okLog(`开始 ${stepName} …`);
        npmRun(['run', npmScript]);
    }
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    okLog(`全部检查通过，耗时 ${elapsedSeconds}s`);
}

cliMain(() => {
    const { isSkipFormat } = parseArgs(process.argv.slice(2));
    runChecks(isSkipFormat);
});
