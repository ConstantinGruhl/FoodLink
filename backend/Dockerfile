# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# reuse deps from deps stage, then prune dev deps (no need to run npm again)
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY package.json ./
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node","dist/server.js"]
