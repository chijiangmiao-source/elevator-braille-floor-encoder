# syntax=docker/dockerfile:1

# ---- 构建静态资源 ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- 静态 Web（nginx 托管 dist） ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- 一次性验收：Vitest 单元测试 + 对静态 Web 跑 Playwright ----
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV PLAYWRIGHT_BASE_URL=http://web:80
CMD ["sh", "-c", "npm run test && npx playwright test"]
