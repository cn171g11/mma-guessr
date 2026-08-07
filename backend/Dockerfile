# ---- 构建阶段 ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# tsc 不会复制 .sql 迁移文件，而 migrate.js 按 dist/db/ 相对路径读取，必须显式拷入
COPY src/db/migrations ./dist/db/migrations

EXPOSE 3000

CMD ["node", "dist/index.js"]