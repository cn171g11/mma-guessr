import { Router } from 'express';
import { z } from 'zod';

import * as achievementsService from '../achievements/service.js';
import { requireAuth } from '../middleware/authenticate.js';
import { playerRefOf } from '../utils/playerRef.js';
import { parseBody } from '../utils/validate.js';

const titleSchema = z.object({
    title: z.string().max(40, '称号过长').optional().nullable(),
});

export const achievementsRouter = Router();

// 成就列表 + 已解锁时间 + 当前装备称号（仅注册用户）
achievementsRouter.get('/', requireAuth, async (req, res) => {
    const payload = await achievementsService.getAchievements(playerRefOf(req));
    res.json(payload);
});

// 装备称号；title 为空则卸下
achievementsRouter.put('/title', requireAuth, async (req, res) => {
    const { title } = parseBody(titleSchema, req.body);
    const equippedTitle = await achievementsService.equipTitle(playerRefOf(req), title ?? null);
    res.json({ equippedTitle });
});

// 卸下称号
achievementsRouter.delete('/title', requireAuth, async (req, res) => {
    const equippedTitle = await achievementsService.equipTitle(playerRefOf(req), null);
    res.json({ equippedTitle });
});
