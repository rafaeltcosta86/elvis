FROM node:22-alpine

RUN apk add --no-cache openssl python3 make g++

WORKDIR /app

COPY pnpm-lock.yaml ./
RUN npm install -g pnpm@9.0.0

COPY . .

RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/baileys

RUN pnpm build

VOLUME /data/auth

EXPOSE 3001

CMD ["node", "dist/index.js"]
