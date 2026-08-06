import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        setupFiles: ['test/setup.ts'],
        fileParallelism: false,
        testTimeout: 15000,
        hookTimeout: 60000,
        pool: 'forks',
    },
});
