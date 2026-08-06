import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function colorize(escapeCode, message) {
    return useColor ? `\u001b[${escapeCode}m${message}\u001b[0m` : message;
}

export const log = (message) => console.log(colorize(36, `[scripts] ${message}`));
export const okLog = (message) => console.log(colorize(32, `[scripts] ${message}`));
export const warnLog = (message) => console.warn(colorize(33, `[scripts] ${message}`));
export const errorLog = (message) => console.error(colorize(31, `[scripts] ${message}`));

export function cliMain(task) {
    Promise.resolve()
        .then(task)
        .catch((err) => {
            errorLog(err instanceof Error ? err.message : String(err));
            process.exitCode = 1;
        });
}

export function npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function quoteArgument(arg) {
    return /\s/.test(arg) ? `"${arg}"` : arg;
}

function buildCommandLine(command, args) {
    return [command, ...args].map(quoteArgument).join(' ');
}

export function run(command, args = [], options = {}) {
    const needsCmdShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    const spawnCommand = needsCmdShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const spawnArgs = needsCmdShell ? ['/d', '/s', '/c', buildCommandLine(command, args)] : args;

    const result = spawnSync(spawnCommand, spawnArgs, {
        cwd: options.cwd ?? projectRoot,
        env: { ...process.env, ...options.env },
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(
            `命令执行失败（退出码 ${result.status ?? result.error?.message}）：${buildCommandLine(command, args)}`
        );
    }
    return result;
}

export function npmRun(args = [], options = {}) {
    return run(npmCommand(), args, options);
}

export function hasCommand(commandName) {
    const probe = process.platform === 'win32' ? ['where', commandName] : ['sh', '-c', `command -v ${commandName}`];
    return spawnSync(probe[0], probe.slice(1), { stdio: 'ignore' }).status === 0;
}

export function ensureEnvFile() {
    const envPath = path.join(projectRoot, '.env');
    if (existsSync(envPath)) {
        return false;
    }
    copyFileSync(path.join(projectRoot, '.env.example'), envPath);
    warnLog('.env 不存在，已从 .env.example 复制，请按需修改（如 JWT 密钥、SMTP）');
    return true;
}

function readEnvValues() {
    const envPath = path.join(projectRoot, '.env');
    if (!existsSync(envPath)) {
        return {};
    }
    const envValues = {};
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (trimmedLine === '' || trimmedLine.startsWith('#')) {
            continue;
        }
        const equalsIndex = trimmedLine.indexOf('=');
        if (equalsIndex <= 0) {
            continue;
        }
        envValues[trimmedLine.slice(0, equalsIndex).trim()] = trimmedLine.slice(equalsIndex + 1).trim();
    }
    return envValues;
}

const DEFAULT_INFRA_URLS = {
    DATABASE_URL: 'postgres://mma:mma@localhost:5432/mma_guessr',
    REDIS_URL: 'redis://localhost:6379',
};

function getEnvValue(key) {
    const fileEnvValues = readEnvValues();
    return process.env[key] ?? fileEnvValues[key] ?? DEFAULT_INFRA_URLS[key];
}

export async function checkInfra() {
    const { Pool } = await import('pg');
    const pgPool = new Pool({
        connectionString: getEnvValue('DATABASE_URL'),
        connectionTimeoutMillis: 2500,
    });
    let pgOk = false;
    try {
        const probe = await pgPool.query('SELECT 1');
        pgOk = probe.rows.length === 1;
    } catch {
        pgOk = false;
    } finally {
        await pgPool.end();
    }

    const { Redis } = await import('ioredis');
    const redisClient = new Redis(getEnvValue('REDIS_URL'), {
        lazyConnect: true,
        connectTimeout: 2500,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
    });
    let redisOk = false;
    try {
        await redisClient.connect();
        redisOk = (await redisClient.ping()) === 'PONG';
    } catch {
        redisOk = false;
    } finally {
        redisClient.disconnect();
    }

    return { pgOk, redisOk };
}

export async function assertInfraReady() {
    const { pgOk, redisOk } = await checkInfra();
    const failureReasons = [];
    if (!pgOk) {
        failureReasons.push('PostgreSQL 不可达（请检查 DATABASE_URL，或运行 npm run db:up 启动容器）');
    }
    if (!redisOk) {
        failureReasons.push('Redis 不可达（请检查 REDIS_URL，或运行 npm run db:up 启动容器）');
    }
    if (failureReasons.length > 0) {
        throw new Error(`依赖服务未就绪：\n- ${failureReasons.join('\n- ')}`);
    }
    okLog('PostgreSQL / Redis 连接正常');
}
