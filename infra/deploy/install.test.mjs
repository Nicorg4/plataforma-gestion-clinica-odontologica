import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const source = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(source, '../..')
const wrapper = `
function . { builtin source "$TEST_RELEASE"; }
function id { printf '%s\\n' "$TEST_UID"; }
function apt-get { return 90; }
function docker {
  printf '%s\\n' "$*" >> "$TEST_TRACE"
  if [ "$*" = 'compose version' ]; then return "\${TEST_COMPOSE_STATUS:-0}"; fi
  if [ "$*" = 'buildx version' ]; then return "\${TEST_BUILDX_STATUS:-0}"; fi
  if [ "$*" = 'compose logs backend' ]; then printf '{"codigo":"DEMO"}\\n'; fi
  if [ "$2" = cp ]; then
    if [ "\${TEST_CERT_STATUS:-0}" != 0 ]; then return 1; fi
    printf 'certificate' > "\${@: -1}"
  fi
}
function curl {
  printf '%s\\n' "$*" >> "$TEST_TRACE"
  return "\${TEST_HEALTH_STATUS:-0}"
}
builtin source "$TEST_INSTALLER" "$@"
`

function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sgo-install-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, 'infra/deploy'), { recursive: true })
  copyFileSync(path.join(source, 'install.sh'), path.join(directory, 'infra/deploy/install.sh'))
  copyFileSync(path.join(root, '.env.example'), path.join(directory, '.env.example'))
  writeFileSync(path.join(directory, 'os-release'), `ID=${options.os ?? 'ubuntu'}\nVERSION_CODENAME=noble\n`)
  if (options.env) writeFileSync(path.join(directory, '.env'), options.env)
  const run = (address = '192.168.0.10', env = {}) => spawnSync('bash', ['-c', wrapper, '--', address], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_UID: '0',
      TEST_RELEASE: path.join(directory, 'os-release'),
      TEST_TRACE: path.join(directory, 'trace'),
      TEST_INSTALLER: path.join(directory, 'infra/deploy/install.sh'),
      ...env,
    },
  })
  return {
    directory, run,
    trace: () => readFileSync(path.join(directory, 'trace'), 'utf8'),
    contents: () => readFileSync(path.join(directory, '.env'), 'utf8'),
  }
}

test('instalador: crea un entorno privado coherente y comprueba la salud', (t) => {
  const f = fixture(t)
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const content = f.contents()
  const password = /^POSTGRES_PASSWORD=(.+)$/m.exec(content)?.[1]
  assert.match(password, /^[a-f0-9]{48}$/)
  assert.ok(content.includes(`DATABASE_URL=postgresql://sgo:${password}@localhost:5432/sgo`))
  assert.ok(content.includes('NODE_ENV=production'))
  assert.ok(content.includes('PUBLIC_ORIGIN=https://192.168.0.10'))
  assert.equal(statSync(path.join(f.directory, '.env')).mode & 0o777, 0o600)
  assert.match(f.trace(), /compose up -d --build --wait/)
  assert.match(f.trace(), /--resolve 192\.168\.0\.10:443:127\.0\.0\.1 https:\/\/192\.168\.0\.10:443\/api\/health/)
  assert.match(result.stdout, /Código de instalación para el asistente: DEMO/)
  assert.equal(readFileSync(path.join(f.directory, 'caddy-root.crt'), 'utf8'), 'certificate')
})

test('instalador: conserva el entorno existente y respeta el puerto configurado', (t) => {
  const content = 'SITE_ADDRESS=clinica.local\nPUBLIC_ORIGIN=https://clinica.local:8443\nHTTPS_PORT=8443\nPOSTGRES_PASSWORD=existente\n'
  const f = fixture(t, { env: content })
  const result = f.run('clinica.local')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(f.contents(), content)
  assert.match(result.stdout, /Abrir https:\/\/clinica.local:8443/)
  assert.match(f.trace(), /clinica\.local:8443:127\.0\.0\.1/)
  assert.equal(statSync(path.join(f.directory, '.env')).mode & 0o777, 0o600)
})

test('instalador: rechaza un origen que no coincide antes de levantar servicios', (t) => {
  const f = fixture(t, { env: 'SITE_ADDRESS=clinica.local\nPUBLIC_ORIGIN=https://clinica.local\nHTTPS_PORT=8443\n' })
  const result = f.run('clinica.local')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PUBLIC_ORIGIN/)
  assert.doesNotMatch(f.trace(), /compose up/)
})

test('instalador: rechaza entradas invalidas y sistemas incompatibles', (t) => {
  const f = fixture(t)
  for (const address of ['', 'https://clinica.local', 'clinica.local:8443', 'nombre|otro', 'nombre/ruta']) {
    assert.equal(f.run(address).status, 1)
  }
  assert.equal(f.run('clinica.local', { TEST_UID: '1000' }).status, 1)
  const debian = fixture(t, { os: 'debian' })
  assert.match(debian.run().stderr, /Ubuntu Server/)
})

test('instalador: exige los plugins antes de crear el entorno', (t) => {
  const f = fixture(t)
  for (const env of [{ TEST_COMPOSE_STATUS: '1' }, { TEST_BUILDX_STATUS: '1' }]) {
    assert.equal(f.run('clinica.local', env).status, 1)
  }
  assert.doesNotMatch(f.trace(), /compose up/)
})

test('instalador: falla si la salud no responde y avisa si falta el certificado', (t) => {
  const f = fixture(t)
  const unhealthy = f.run('clinica.local', { TEST_HEALTH_STATUS: '1' })
  assert.equal(unhealthy.status, 1)
  assert.match(unhealthy.stderr, /no responde/)
  const certificate = f.run('clinica.local', { TEST_CERT_STATUS: '1' })
  assert.equal(certificate.status, 0, certificate.stderr)
  assert.match(certificate.stderr, /No se pudo copiar el certificado/)
})
