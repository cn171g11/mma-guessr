import bcrypt from 'bcryptjs';

import { APP_CONSTANTS } from '../config/env.js';

export async function hashPassword(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, APP_CONSTANTS.BCRYPT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, passwordHash);
}
