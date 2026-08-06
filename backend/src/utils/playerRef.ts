import type { Request } from 'express';

import type { PlayerRef } from '../games/types.js';
import { badRequest } from './httpError.js';

export function playerRefOf(req: Request): PlayerRef {
    if (req.auth === undefined) {
        throw badRequest('缺少身份信息');
    }
    return { role: req.auth.role, id: req.auth.subject };
}
