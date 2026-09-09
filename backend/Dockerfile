FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --no-audit --no-fund
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json
RUN npm run build --workspace backend
RUN npm prune --omit=dev --workspace backend --no-audit --no-fund
ENV NODE_ENV=production PORT=8000
USER node
EXPOSE 8000
CMD ["node", "backend/dist/server.js"]
