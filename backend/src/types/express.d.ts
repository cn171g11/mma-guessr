import type { TokenSubject } from '../auth/tokens.js';

declare global {
    namespace Express {
        interface Request {
            auth?: TokenSubject;
        }
    }
}

export {};
