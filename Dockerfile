FROM oven/bun:1.3.6 AS prisma-build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN bun run generate

FROM oven/bun:1.3.6
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --chown=bun:bun . .
COPY --from=prisma-build --chown=bun:bun /app/src/generated/prisma ./src/generated/prisma
RUN mkdir -p /app/data/materials && chown -R bun:bun /app/data
USER bun
EXPOSE 3333
CMD ["sh", "-c", "bun run migrate && bun run start"]
