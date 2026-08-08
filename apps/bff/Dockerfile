# Contexto de build: la RAÍZ del monorepo (ver docker-compose.yml), no ./apps/bff.
# Necesario para resolver dependencias de workspace (packages/rubric, packages/shared)
# vía pnpm. Nunca construir esta imagen en el droplet: solo en CI -> GHCR.

FROM node:22-alpine AS base
# openssl: los binarios de motor de Prisma para musl (linux-musl-openssl-3.0.x,
# ver schema.prisma) lo necesitan en runtime; node:22-alpine no lo trae por defecto.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /repo

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter taller-bff run build

FROM base AS runtime
COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json /repo/pnpm-lock.yaml ./
COPY --from=builder /repo/apps/bff/package.json apps/bff/package.json
# prisma/schema.prisma tiene que estar presente ANTES del install de abajo:
# el script postinstall corre `prisma generate`, que lee este archivo.
COPY --from=builder /repo/apps/bff/prisma apps/bff/prisma
RUN pnpm install --filter taller-bff --frozen-lockfile --prod
COPY --from=builder /repo/apps/bff/dist apps/bff/dist

WORKDIR /repo/apps/bff
EXPOSE 4000
CMD ["node", "dist/index.js"]
