import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

describe('backend release guardrails', () => {
  test('production Compose cannot activate deferred payments or metrics from a stale VM environment', async () => {
    const compose = await read('deploy/compose.yml')
    expect(compose).toContain('INFINITEPAY_HANDLE: ""')
    expect(compose).toContain('METRICS_BEARER_TOKEN: ""')
    expect(compose).toContain('PUBLIC_APP_URL: ${PUBLIC_APP_URL:-https://masterme-frontend.joaovictorcortabitart.workers.dev}')
  })

  test('CI validates dependencies, Compose, image and smoke test with required PostgreSQL', async () => {
    const workflow = await read('.github/workflows/ci.yml')
    expect(workflow).toContain("MIGRATION_TEST_REQUIRED: 'true'")
    expect(workflow).toContain('bun run validate')
    expect(workflow).toContain('bun run validate:dependencies')
    expect(workflow).toContain('docker compose -f deploy/compose.yml config --quiet')
    expect(workflow).toContain('load: true')
    expect(workflow).toContain('./scripts/smoke-production-image.sh masterme-backend:ci')
  })

  test('deployment remains exclusive to main, is never cancelled and repeats validations', async () => {
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

  test('image runs as non-root and build context excludes environments and Git metadata', async () => {
    const [dockerfile, dockerignore] = await Promise.all([read('Dockerfile'), read('.dockerignore')])
    expect(dockerfile).toContain('bun install --frozen-lockfile --production')
    expect(dockerfile.indexOf('USER bun')).toBeGreaterThan(-1)
    expect(dockerfile.indexOf('USER bun')).toBeLessThan(dockerfile.indexOf('CMD ['))
    expect(dockerignore.split('\n')).toContain('.env.*')
    expect(dockerignore.split('\n')).toContain('.git')
  })
})
