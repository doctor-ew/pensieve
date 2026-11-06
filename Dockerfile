FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY web ./web
EXPOSE 8080
CMD ["node", "dist/cli.js", "sharing-server", "--home", "/data", "--host", "0.0.0.0"]
