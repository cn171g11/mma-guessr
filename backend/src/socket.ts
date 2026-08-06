import type http from 'node:http';

import { Server } from 'socket.io';
import { createLogger } from './logger/index.js';
import { createMultiplayerService, type MultiplayerService } from './multiplayer/service.js';
import { isOriginAllowed } from './utils/cors.js';

const log = createLogger('socket');

let multiplayerService: MultiplayerService | null = null;

export function attachSocketServer(httpServer: http.Server): Server {
    // 与 REST 同源白名单：仅放行配置的前端域名（开发默认 localhost），拒绝时握手直接失败
    const io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
        },
    });
    multiplayerService = createMultiplayerService(io);
    log.info('Socket.IO 已挂载');
    return io;
}

export function stopSocketServer(): void {
    multiplayerService?.stop();
    multiplayerService = null;
}
