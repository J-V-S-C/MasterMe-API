FROM oven/bun:1.3.6
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY --chown=bun:bun . .
RUN mkdir -p /app/data/materials && chown -R bun:bun /app/data
USER bun
EXPOSE 3333
CMD ["sh", "-c", "bun run migrate && bun run start"]
