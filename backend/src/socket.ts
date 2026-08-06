import type http from 'node:http';

import { Server } from 'socket.io';
import { createLogger } from './logger/index.js';
import { createMultiplayerService, type MultiplayerService } from './multiplayer/service.js';

const log = createLogger('socket');

let multiplayerService: MultiplayerService | null = null;

export function attachSocketServer(httpServer: http.Server): Server {
    const io = new Server(httpServer, { cors: { origin: '*' } });
    multiplayerService = createMultiplayerService(io);
    log.info('Socket.IO 已挂载');
    return io;
}

export function stopSocketServer(): void {
    multiplayerService?.stop();
    multiplayerService = null;
}
