FROM oven/bun:1.3.6
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 3333
CMD ["sh", "-c", "bun run migrate && bun run start"]
