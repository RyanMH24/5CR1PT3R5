import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OfficeConfig {
  /** The 5CR1PT3R5 package directory. */
  root: string;
  /** Runtime state: jobs, logs, desk locks. */
  home: string;
  /** Where agents create their task folders: one new folder per prompt. */
  projectsDir: string;
  claudeBin: string;
  /** Kill a job that runs longer than this. */
  jobTimeoutMs: number;
  /** Script runner the scripter agents use to check and run their own scripts. */
  runScript: string;
  /** Design database search used by agents with `designSearch` (see src/design-search.ts). */
  designSearch: string;
  /** Start background workers for queued jobs. Off only for tests and embedding hosts. */
  startWorkers: boolean;
  /**
   * Extra HTTPS origins the office page may be opened from, e.g. a `tailscale serve` address, so
   * your own phone can send work. The host still only listens on 127.0.0.1.
   */
  allowedOrigins: string[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OfficeConfig {
  const timeoutMin = Number(env.OFFICE_JOB_TIMEOUT_MIN ?? 45);
  return {
    root: ROOT,
    home: resolve(env.OFFICE_HOME ?? join(ROOT, '.office')),
    // 5CR1PT3R5 lives in Projects/; everything the agents make goes in Projects/Agents Work.
    projectsDir: resolve(env.OFFICE_PROJECTS_DIR ?? join(ROOT, '..', 'Agents Work')),
    claudeBin: env.OFFICE_CLAUDE_BIN ?? findClaude(env),
    jobTimeoutMs: (Number.isFinite(timeoutMin) && timeoutMin > 0 ? timeoutMin : 45) * 60_000,
    runScript: join(ROOT, 'bin', 'run-script.mjs'),
    designSearch: join(ROOT, 'bin', 'design-search.mjs'),
    startWorkers: env.OFFICE_START_WORKERS !== '0',
    allowedOrigins: parseOrigins(env.OFFICE_ALLOWED_ORIGINS),
  };
}

/** Comma-separated HTTPS origins; anything else is dropped, since plain HTTP could be read on the way. */
export function parseOrigins(value: string | undefined): string[] {
  const origins = new Set<string>();
  for (const part of (value ?? '').split(',')) {
    try {
      const url = new URL(part.trim());
      if (url.protocol === 'https:') origins.add(url.origin);
    } catch {
      // not a URL; skip it
    }
  }
  return [...origins];
}

/** Locate the Claude Code CLI on PATH, falling back to the native installer's location. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string {
  // Only real executables: a .cmd shim would need a shell, and the persona text would then
  // need cmd.exe quoting. The native installer (and npm's platform package) ship claude.exe.
  const names = IS_WINDOWS ? ['claude.exe'] : ['claude'];
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(homedir(), '.local', 'bin'));
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'claude';
}
