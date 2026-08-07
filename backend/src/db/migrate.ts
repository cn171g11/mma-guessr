import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pool } from './pool.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('db:migrate');

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_NAME_PATTERN = /^\d{3}_.+\.sql$/i;

async function ensureTrackingTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function listMigrationFiles(): Promise<string[]> {
    const entries = await readdir(migrationsDir);
    return entries.filter((entry) => MIGRATION_NAME_PATTERN.test(entry)).sort();
}

async function findAppliedMigrations(): Promise<Set<string>> {
    const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    return new Set(result.rows.map((row) => row.name));
}

async function applyMigration(fileName: string): Promise<void> {
    const sql = await readFile(path.join(migrationsDir, fileName), 'utf8');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [fileName]);
        await client.query('COMMIT');
        log.info(`已应用迁移 ${fileName}`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function runMigrations(): Promise<void> {
    log.info('开始执行数据库迁移...');
    await ensureTrackingTable();
    const applied = await findAppliedMigrations();
    const migrationFiles = await listMigrationFiles();

    log.info(`发现 ${migrationFiles.length} 个迁移文件，已应用 ${applied.size} 个`);
    for (const fileName of migrationFiles) {
        if (applied.has(fileName)) {
            continue;
        }
        await applyMigration(fileName);
    }

    log.info(`迁移完成，共 ${migrationFiles.length} 个迁移文件`);
}

const isMainModule: boolean = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    // Force-exit so CI never hangs on lingering pool connections (tsx can mis-detect main module)
    runMigrations()
        .then(() => pool.end())
        .then(() => process.exit(0))
        .catch(async (err: unknown) => {
            log.error('数据库迁移失败', err);
            try {
                await pool.end();
            } finally {
                process.exit(1);
            }
        });
}
