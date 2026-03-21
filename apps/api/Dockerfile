FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY pnpm-lock.yaml ./
RUN npm install -g pnpm@9.0.0

COPY . .

RUN pnpm install --frozen-lockfile

RUN cd /app/apps/api && node_modules/.bin/prisma generate

RUN pnpm --filter @elvis/shared build

WORKDIR /app/apps/api

RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
