import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

describe('guardrails da release backend', () => {
  test('CI valida dependências, Compose, imagem e smoke com PostgreSQL obrigatório', async () => {
    const workflow = await read('.github/workflows/ci.yml')
    expect(workflow).toContain("MIGRATION_TEST_REQUIRED: 'true'")
    expect(workflow).toContain('bun run validate')
    expect(workflow).toContain('bun run validate:dependencies')
    expect(workflow).toContain('docker compose -f deploy/compose.yml config --quiet')
    expect(workflow).toContain('load: true')
    expect(workflow).toContain('./scripts/smoke-production-image.sh masterme-backend:ci')
  })

  test('deploy continua exclusivo de main, sem cancelamento e repete validações', async () => {
    const workflow = await read('.github/workflows/deploy.yml')
    expect(workflow).toContain('branches: [main]')
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'")
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain("MIGRATION_TEST_REQUIRED: 'true'")
    expect(workflow).toContain('bun run validate')
    expect(workflow).toContain('bun run validate:dependencies')
    expect(workflow).toContain('docker compose -f deploy/compose.yml config --quiet')
    expect(workflow).toContain('./scripts/smoke-production-image.sh masterme-backend:predeploy')
    expect(workflow).not.toContain('pull_request:')
  })

  test('imagem é non-root e contexto exclui ambientes e metadados Git', async () => {
    const [dockerfile, dockerignore] = await Promise.all([read('Dockerfile'), read('.dockerignore')])
    expect(dockerfile).toContain('bun install --frozen-lockfile --production')
    expect(dockerfile.indexOf('USER bun')).toBeGreaterThan(-1)
    expect(dockerfile.indexOf('USER bun')).toBeLessThan(dockerfile.indexOf('CMD ['))
    expect(dockerignore.split('\n')).toContain('.env.*')
    expect(dockerignore.split('\n')).toContain('.git')
  })
})
