import { pool } from '../db/pool.js';
import { conflict, notFound } from '../utils/httpError.js';

export interface UserRecord {
    id: string;
    username: string;
    email: string;
    password_hash: string;
    created_at: Date;
    updated_at: Date;
}

export interface PublicUserProfile {
    id: string;
    username: string;
    email: string;
    createdAt: string;
}

export interface NewUserInput {
    username: string;
    email: string;
    passwordHash: string;
}

interface UserRow {
    id: string;
    username: string;
    email: string;
    password_hash: string;
    created_at: string;
    updated_at: string;
}

const UNIQUE_ALREADY_EXISTS_CODE = '23505';

function isUniqueViolation(err: unknown): boolean {
    return err instanceof Error && 'code' in err && (err as { code?: unknown }).code === UNIQUE_ALREADY_EXISTS_CODE;
}

function mapUserRow(row: UserRow): UserRecord {
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        password_hash: row.password_hash,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
    const result = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    const userRow = result.rows[0];
    return userRow === undefined ? null : mapUserRow(userRow);
}

export async function getRequiredUserById(userId: string): Promise<UserRecord> {
    const user = await findUserById(userId);
    if (user === null) {
        throw notFound('用户不存在');
    }
    return user;
}

export async function findUserByIdentifier(identifier: string): Promise<UserRecord | null> {
    const result = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1 OR username = $1 LIMIT 1', [
        identifier,
    ]);
    const userRow = result.rows[0];
    return userRow === undefined ? null : mapUserRow(userRow);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
    const userRow = result.rows[0];
    return userRow === undefined ? null : mapUserRow(userRow);
}

export async function createUser(userInput: NewUserInput): Promise<UserRecord> {
    try {
        const result = await pool.query<UserRow>(
            `INSERT INTO users (username, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [userInput.username, userInput.email, userInput.passwordHash]
        );
        const userRow = result.rows[0];
        if (userRow === undefined) {
            throw new Error('创建用户失败：未返回记录');
        }
        return mapUserRow(userRow);
    } catch (err) {
        if (isUniqueViolation(err)) {
            throw conflict('用户名或邮箱已被使用');
        }
        throw err;
    }
}

export function toPublicProfile(user: UserRecord): PublicUserProfile {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at.toISOString(),
    };
}
