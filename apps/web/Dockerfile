# Contexto de build: la RAÍZ del monorepo (igual que apps/bff/Dockerfile), para
# resolver el pnpm workspace. Nunca construir esta imagen en el droplet: solo en
# CI -> GHCR (rebanada 12).

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter taller-web run build

FROM nginx:1.27-alpine
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
