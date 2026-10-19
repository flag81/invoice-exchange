#!/usr/bin/env node
/**
 * Dev database helper — `pnpm db:dev`, `pnpm db:dev:stop`, `pnpm db:dev:status`.
 *
 * Phase 0 has no infra yet, so the goal here is narrow: a developer runs one command and gets a
 * PostgreSQL that matches `DATABASE_URL` in `.env`, without installing anything into the repo. Two
 * providers are supported, chosen by what is actually available on the machine:
 *
 *   1. `pg_ctl` + `initdb` (a normal local PostgreSQL install). The cluster is created inside
 *      `.devdata/pgdata/` and listens on the port from `DATABASE_URL`, so the repo stays self-contained
 *      and deleting `.devdata/` resets the world.
 *   2. Docker — a container named `invoice-exchange-dev-db` with a named volume.
 *
 * If neither exists the script fails with an actionable message instead of pretending to work: there
 * is no bundled server binary here, and a "start" that silently does nothing is worse than an error.
 *
 * Deliberate choices:
 *   - The password from `DATABASE_URL` is never printed; only host/port/user/database are reported.
 *   - Both the main and the test database from `.env` are created, so integration tests in phase 2 do
 *     not need a second setup step.
 *   - Readiness is a TCP connect, not a `psql` invocation, so it works for either provider.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DATA_ROOT = resolve(REPO_ROOT, '.devdata');
const PGDATA = resolve(DATA_ROOT, 'pgdata');
const LOG_FILE = resolve(DATA_ROOT, 'postgres.log');
const CONTAINER = 'invoice-exchange-dev-db';
const POSTGRES_IMAGE = 'postgres:17';
const READY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/** Minimal `.env` reader: `KEY=value`, quotes optional, `#` starts a comment. */
function readDotEnv(file) {
  if (!existsSync(file)) return {};

  const values = {};
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      (value.startsWith('"') || value.startsWith("'")) &&
      value.endsWith(value[0])
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Real environment wins over `.env`, which wins over `.env.example` (same order as Next.js). */
const env = {
  ...readDotEnv(resolve(REPO_ROOT, '.env.example')),
  ...readDotEnv(resolve(REPO_ROOT, '.env')),
  ...process.env,
};

/** Splits a connection string into the pieces the providers need. */
function parseConnection(raw) {
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) return null;

  return {
    host: url.hostname === '' ? '127.0.0.1' : url.hostname,
    port: url.port === '' ? '5432' : url.port,
    user: url.username === '' ? 'postgres' : decodeURIComponent(url.username),
    password: url.password === '' ? 'postgres' : decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || 'invoice_exchange',
  };
}

const main = parseConnection(env.DATABASE_URL);
const test = parseConnection(env.TEST_DATABASE_URL);

/** Databases the dev setup must guarantee exist. */
const REQUIRED_DATABASES = [
  ...new Set(
    [main?.database, test?.database].filter((name) => typeof name === 'string' && name !== ''),
  ),
];

function describeTarget() {
  if (!main) return 'DATABASE_URL is not set (cp .env.example .env)';
  return `${main.host}:${main.port}/${main.database} as ${main.user} (password not shown)`;
}

// ---------------------------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------------------------

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: false,
    ...options,
  });
}

function hasCommand(command, versionFlag = '--version') {
  const result = run(command, [versionFlag], { capture: true });
  return result.error === undefined && result.status === 0;
}

const providers = {
  native: () => hasCommand('pg_ctl') && hasCommand('initdb'),
  docker: () => hasCommand('docker', '--version'),
};

function provider() {
  if (providers.native()) return 'native';
  if (providers.docker()) return 'docker';
  return null;
}

/** TCP readiness: works for a container and for a local cluster alike. */
async function waitForPort({ host, port }, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const open = await new Promise((resolveOpen) => {
      const socket = createConnection({ host, port: Number(port) });
      socket.once('connect', () => {
        socket.end();
        resolveOpen(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolveOpen(false);
      });
    });

    if (open) return true;
    await delay(500);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Provider: a native PostgreSQL install (pg_ctl/initdb), cluster kept inside the repo
// ---------------------------------------------------------------------------------------------

const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function nativeIsRunning() {
  if (!existsSync(PGDATA)) return false;
  return run('pg_ctl', ['status', '-D', PGDATA], { capture: true }).status === 0;
}

/**
 * Creates the required databases. `initdb` only creates `postgres`; Prisma cannot apply migrations
 * until the database named in `DATABASE_URL` exists, so this is part of "start".
 */
function nativeEnsureDatabases() {
  if (!hasCommand('psql')) {
    console.warn(
      '! psql was not found on PATH — create the databases manually if migrations fail.',
    );
    return;
  }

  for (const name of REQUIRED_DATABASES) {
    if (!DATABASE_NAME_PATTERN.test(name)) {
      console.warn(`! skipping unexpected database name in .env: ${name}`);
      continue;
    }

    const exists = run(
      'psql',
      [
        '-h',
        main.host,
        '-p',
        main.port,
        '-U',
        main.user,
        '-d',
        'postgres',
        '-tAc',
        `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
      ],
      { capture: true },
    );
    if (exists.stdout.trim() === '1') continue;

    const created = run(
      'psql',
      [
        '-h',
        main.host,
        '-p',
        main.port,
        '-U',
        main.user,
        '-d',
        'postgres',
        '-c',
        `CREATE DATABASE "${name}"`,
      ],
      { capture: true },
    );
    if (created.status === 0) console.log(`  created database ${name}`);
    else console.error(`  could not create ${name}: ${created.stderr.trim().split('\n')[0]}`);
  }
}

async function nativeStart() {
  mkdirSync(DATA_ROOT, { recursive: true });

  if (!existsSync(PGDATA)) {
    console.log(`  initdb -> ${PGDATA} (trust auth: local dev cluster, loopback only)`);
    const initialised = run('initdb', [
      '-D',
      PGDATA,
      '-U',
      main.user,
      '--auth=trust',
      '--encoding=UTF8',
    ]);
    if (initialised.status !== 0) return 1;
  }

  if (nativeIsRunning()) {
    console.log('  cluster is already running.');
  } else {
    const started = run(
      'pg_ctl',
      ['-D', PGDATA, '-l', LOG_FILE, '-o', `-p ${main.port}`, '-w', 'start'],
      // On Windows the started server inherits this process's console, so `pnpm db:dev` would print
      // "Ready" and then never give the terminal back. The server writes to LOG_FILE anyway.
      { stdio: 'ignore' },
    );
    if (started.status !== 0) {
      console.error(`! pg_ctl could not start the cluster — see ${LOG_FILE}`);
      return 1;
    }
  }

  if (!(await waitForPort(main))) {
    console.error(
      `! nothing accepted a connection on ${main.host}:${main.port} within ${READY_TIMEOUT_MS} ms`,
    );
    return 1;
  }

  nativeEnsureDatabases();
  return 0;
}

function nativeStop() {
  if (!existsSync(PGDATA)) {
    console.log('  no repo-local cluster to stop.');
    return 0;
  }
  if (!nativeIsRunning()) {
    console.log('  cluster is not running.');
    return 0;
  }

  return run('pg_ctl', ['-D', PGDATA, '-m', 'fast', 'stop']).status === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------
// Provider: Docker
// ---------------------------------------------------------------------------------------------

const DOCKER_VOLUME = 'invoice-exchange-dev-db-data';

function dockerContainerState() {
  const result = run('docker', ['inspect', '-f', '{{.State.Status}}', CONTAINER], {
    capture: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function dockerStart() {
  const state = dockerContainerState();

  if (state === null) {
    console.log(`  docker run -> ${CONTAINER} (${POSTGRES_IMAGE}), volume ${DOCKER_VOLUME}`);
    const created = run('docker', [
      'run',
      '-d',
      '--name',
      CONTAINER,
      '-e',
      `POSTGRES_USER=${main.user}`,
      '-e',
      `POSTGRES_PASSWORD=${main.password}`,
      '-e',
      `POSTGRES_DB=${main.database}`,
      '-p',
      `${main.port}:5432`,
      '-v',
      `${DOCKER_VOLUME}:/var/lib/postgresql/data`,
      POSTGRES_IMAGE,
    ]);
    if (created.status !== 0) return 1;
  } else if (state === 'running') {
    console.log('  container is already running.');
  } else {
    if (run('docker', ['start', CONTAINER]).status !== 0) return 1;
  }

  if (!(await waitForPort(main))) {
    console.error(
      `! the container did not accept a connection on ${main.host}:${main.port} within ${READY_TIMEOUT_MS} ms`,
    );
    return 1;
  }

  // POSTGRES_DB only creates the main database, so the test database needs an explicit statement.
  for (const name of REQUIRED_DATABASES) {
    if (!DATABASE_NAME_PATTERN.test(name) || name === main.database) continue;
    run(
      'docker',
      [
        'exec',
        CONTAINER,
        'psql',
        '-U',
        main.user,
        '-d',
        'postgres',
        '-c',
        `CREATE DATABASE "${name}"`,
      ],
      {
        capture: true,
      },
    );
  }
  return 0;
}

function dockerStop() {
  if (dockerContainerState() === null) {
    console.log('  no dev container exists.');
    return 0;
  }
  return run('docker', ['stop', CONTAINER]).status === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

function usage() {
  console.log(`Usage: node scripts/dev-db.mjs <start|stop|status>

  start   create (if needed) and start the dev PostgreSQL described by DATABASE_URL, then create
          ${REQUIRED_DATABASES.length > 0 ? REQUIRED_DATABASES.join(', ') : 'the configured databases'}
  stop    stop it (data is kept)
  status  report which provider applies and whether anything is listening

Providers, in order of preference: pg_ctl/initdb (cluster in .devdata/pgdata) then Docker.
With neither installed, run an existing server instead and point DATABASE_URL at it.`);
}

/** Prints (and returns) the provider that would be used, so `start`/`stop` can refuse early. */
function reportProvider() {
  const selected = provider();
  if (selected === 'native') console.log('  provider: local PostgreSQL (pg_ctl/initdb)');
  else if (selected === 'docker') console.log('  provider: Docker');
  else console.log('  provider: none found — install PostgreSQL >= 15 or Docker');
  return selected;
}

async function start() {
  const selected = reportProvider();
  console.log(`  target:   ${describeTarget()}`);

  if (selected === null) {
    console.error('\n! No way to start a database on this machine.');
    console.error(
      '  Install PostgreSQL >= 15 (so `pg_ctl` and `initdb` are on PATH) or Docker, or',
    );
    console.error('  start a server yourself and point DATABASE_URL at it.');
    return 1;
  }
  if (!main) {
    console.error('\n! DATABASE_URL is missing or is not a postgresql:// URL — check .env.');
    return 1;
  }

  const code = selected === 'native' ? await nativeStart() : await dockerStart();
  if (code === 0) console.log('\nReady. Next: pnpm db:generate && pnpm db:migrate && pnpm db:seed');
  return code;
}

async function stop() {
  const selected = reportProvider();
  if (selected === null) {
    // Idempotent, like the provider branches: "nothing here to stop" is a success, not an error.
    console.warn('! nothing to stop: no local cluster and no Docker.');
    return 0;
  }
  return selected === 'native' ? nativeStop() : dockerStop();
}

async function status() {
  const selected = reportProvider();
  console.log(`  target:   ${describeTarget()}`);

  if (selected === 'native') {
    console.log(`  cluster:  ${existsSync(PGDATA) ? PGDATA : 'not created yet'}`);
    console.log(`  state:    ${nativeIsRunning() ? 'running' : 'stopped'}`);
  } else if (selected === 'docker') {
    console.log(`  container ${CONTAINER}: ${dockerContainerState() ?? 'not created yet'}`);
  }

  if (main) {
    const reachable = await waitForPort(main, 1_000);
    console.log(`  port ${main.port}: ${reachable ? 'accepting connections' : 'closed'}`);
  }
  return 0;
}

const [, , command = 'status'] = process.argv;

if (['--help', '-h', 'help'].includes(command)) {
  usage();
} else if (command === 'start') {
  process.exitCode = await start();
} else if (command === 'stop') {
  process.exitCode = await stop();
} else if (command === 'status') {
  process.exitCode = await status();
} else {
  console.error(`Unknown command: ${command}\n`);
  usage();
  process.exitCode = 2;
}
