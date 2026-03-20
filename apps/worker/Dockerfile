FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY pnpm-lock.yaml ./
RUN npm install -g pnpm@9.0.0

COPY . .

RUN pnpm install --frozen-lockfile

RUN cd /app/apps/api && node_modules/.bin/prisma generate

WORKDIR /app/apps/worker

RUN pnpm build

CMD ["pnpm", "start"]
