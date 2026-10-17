import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('observable deployment guardrails', () => {
  test('documents public access blocking for the entire metrics path', async () => {
    const deployment = await readFile(new URL('../README.md', import.meta.url), 'utf8')
    expect(deployment).toContain('@operational path /metrics /metrics/*')
    expect(deployment.indexOf('respond @operational 404')).toBeLessThan(deployment.indexOf('reverse_proxy 127.0.0.1:3333'))
  })

  test('workflow uses versioned rollback that preserves the readiness failure', async () => {
    const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
    const script = await readFile(new URL('../deploy/deploy-and-verify.sh', import.meta.url), 'utf8')
    expect(workflow).toContain('deploy/deploy-and-verify.sh')
    expect(workflow).toContain('/opt/masterme/deploy-and-verify.sh')
    expect(script.indexOf('docker inspect --format')).toBeLessThan(script.indexOf('docker compose --env-file "$environment_file" -f "$compose_file" pull'))
    expect(script).toContain('MASTERME_IMAGE=$previous_image docker compose')
    expect(script).toContain('exit "$readiness_status"')
  })

  test('readiness failure restores the previous image and preserves the original exit code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'masterme-deploy-test-'))
    const bin = join(directory, 'bin'); const log = join(directory, 'commands.log')
    await mkdir(bin)
    await writeFile(join(directory, '.env'), '')
    await writeFile(join(directory, 'compose.yml'), 'services: {}\n')
    await writeFile(join(bin, 'docker'), `#!/bin/sh
if [ "$1" = "inspect" ]; then echo "ghcr.io/example/masterme:previous"; exit 0; fi
case "$*" in
  *"ps -q api"*) echo "existing-container" ;;
  *"up -d --remove-orphans"*) echo "up:$MASTERME_IMAGE" >> "$MASTERME_TEST_LOG" ;;
esac
exit 0
`)
    await writeFile(join(bin, 'curl'), '#!/bin/sh\nexit 7\n')
    await Promise.all([chmod(join(bin, 'docker'), 0o700), chmod(join(bin, 'curl'), 0o700)])
    try {
      const child = Bun.spawn(['sh', new URL('../deploy/deploy-and-verify.sh', import.meta.url).pathname, 'ghcr.io/example/masterme:new'], {
        env: { ...processEnv(), PATH: `${bin}:${process.env.PATH ?? ''}`, MASTERME_DEPLOY_DIR: directory, MASTERME_TEST_LOG: log },
        stdout: 'ignore', stderr: 'ignore',
      })
      expect(await child.exited).toBe(7)
      expect(await readFile(log, 'utf8')).toContain('up:ghcr.io/example/masterme:new')
      expect(await readFile(log, 'utf8')).toContain('up:ghcr.io/example/masterme:previous')
      expect(await readFile(join(directory, '.previous-image'), 'utf8')).toBe('ghcr.io/example/masterme:previous\n')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  test.each(['stopped', 'lookup_failed'] as const)('worker %s fails the deploy gate and restores the previous image', async (workerMode) => {
    const directory = await mkdtemp(join(tmpdir(), 'masterme-worker-deploy-test-'))
    const bin = join(directory, 'bin'); const log = join(directory, 'commands.log')
    await mkdir(bin)
    await writeFile(join(directory, '.env'), '')
    await writeFile(join(directory, 'compose.yml'), 'services: {}\n')
    await writeFile(join(bin, 'docker'), `#!/bin/sh
if [ "$1" = "inspect" ]; then
  case "$*" in *worker-container*) echo false ;; *) echo "ghcr.io/example/masterme:previous" ;; esac
  exit 0
fi
case "$*" in
  *"ps -q api"*) echo "existing-container" ;;
  *"ps -q worker"*) if [ "${workerMode}" = 'lookup_failed' ]; then exit 7; fi; echo "worker-container" ;;
  *"up -d --remove-orphans"*) echo "up:$MASTERME_IMAGE" >> "$MASTERME_TEST_LOG" ;;
esac
exit 0
`)
    await writeFile(join(bin, 'curl'), '#!/bin/sh\nexit 0\n')
    await Promise.all([chmod(join(bin, 'docker'), 0o700), chmod(join(bin, 'curl'), 0o700)])
    try {
      const child = Bun.spawn(['sh', new URL('../deploy/deploy-and-verify.sh', import.meta.url).pathname, 'ghcr.io/example/masterme:new'], {
        env: { ...processEnv(), PATH: `${bin}:${process.env.PATH ?? ''}`, MASTERME_DEPLOY_DIR: directory, MASTERME_TEST_LOG: log },
        stdout: 'ignore', stderr: 'ignore',
      })
      expect(await child.exited).toBe(1)
      expect(await readFile(log, 'utf8')).toContain('up:ghcr.io/example/masterme:previous')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

const processEnv = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
