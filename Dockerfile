# ============================================================
# Bot Vectorito — Dockerfile Multi-Stage
# ============================================================
# Imagen optimizada para producción con compilación de
# dependencias nativas (sqlite3) y frontend React/Vite.
# ============================================================

# ── Stage 1: Base con herramientas de compilación ────────────
FROM node:24-alpine AS base

# sqlite3 necesita python3 + make + g++ para compilar bindings nativos
RUN apk add --no-cache python3 make g++

WORKDIR /app

# ── Stage 2: Instalar dependencias del backend ──────────────
FROM base AS backend-deps

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 3: Instalar dependencias y compilar el frontend ───
FROM base AS web-build

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web/ ./web/
RUN cd web && npm run build

# ── Stage 4: Compilar TypeScript del backend ─────────────────
FROM backend-deps AS backend-build

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ── Stage 5: Imagen de producción (limpia) ───────────────────
FROM node:24-alpine AS production

# sqlite3 necesita libstdc++ en runtime
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copiar package manifests e instalar solo producción
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copiar backend compilado
COPY --from=backend-build /app/dist ./dist

# Copiar frontend compilado
COPY --from=web-build /app/web/dist ./web/dist

# Copiar scripts auxiliares
COPY scripts/ ./scripts/

# Copiar archivos de configuración
COPY .env.example ./

# Crear directorios para datos persistentes
RUN mkdir -p data session data/ai-context/global

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV TUI_ENABLED=false
ENV SQLITE_PATH=data/chatbot.db

# El servidor HTTP escucha en el puerto 3000
EXPOSE 3000

# Healthcheck básico contra el servidor HTTP
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000/ || exit 1

CMD ["node", "dist/main.js"]
