import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findPython } from './run-script.ts';

/**
 * `design-search <query> [flags]` — the design agent's door into the ui-ux-pro-max skill's local
 * database (styles, palettes, fonts, UX rules). Agents run with skills disabled, because loading
 * the whole plugin would put 7 skill descriptions in every turn and a 16 KB SKILL.md on every use.
 * Instead the agent gets a few persona lines and calls the skill's search script through this
 * wrapper, paying only for the rows it asks for.
 *
 * The wrapper keeps output small (markdown design systems are about 3 KB, the default ASCII art
 * about 8 KB) and keeps persisted files in the task folder.
 */

const PLUGIN_PREFIX = 'ui-ux-pro-max@';
const SEARCH_SCRIPT = join('.claude', 'skills', 'ui-ux-pro-max', 'scripts', 'search.py');
const TIMEOUT_MS = 60_000;

/** Find the skill's search.py: OFFICE_UIUX_DIR, else the installed Claude Code plugin. */
export function findSearchScript(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const roots: string[] = [];
  if (env.OFFICE_UIUX_DIR) roots.push(env.OFFICE_UIUX_DIR);
  try {
    const registry = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as {
      plugins?: Record<string, Array<{ installPath?: string }>>;
    };
    for (const [id, installs] of Object.entries(registry.plugins ?? {})) {
      if (!id.startsWith(PLUGIN_PREFIX)) continue;
      for (const install of installs) if (install.installPath) roots.push(install.installPath);
    }
  } catch {
    // Not installed through Claude Code; only OFFICE_UIUX_DIR can point at it.
  }
  return roots.map((root) => join(root, SEARCH_SCRIPT)).find((p) => existsSync(p));
}

/** Arguments for search.py: compact output, and anything persisted lands in the task folder. */
export function searchArgs(argv: string[], cwd: string): string[] {
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-dir' || argv[i] === '-o') i++; // always the task folder
    else if (argv[i] !== '--force') args.push(argv[i]); // never overwrite a teammate's MASTER.md
  }
  const has = (...flags: string[]) => args.some((a) => flags.includes(a));
  if (has('--design-system', '-ds') && !has('--format', '-f', '--json')) args.push('-f', 'markdown');
  if (has('--persist')) args.push('--output-dir', cwd);
  return args;
}

export function main(argv: string[]): number {
  if (!argv.length || argv[0].startsWith('-')) {
    console.error('Usage: design-search "<2-5 words>" (--design-system [--persist -p "Name"] | --domain <d> | --stack <s>) [-n 3]');
    return 2;
  }
  const script = findSearchScript();
  if (!script) {
    console.error('The ui-ux-pro-max design database is not installed. Use your own design judgement and say so in your summary.');
    return 3;
  }
  const python = findPython();
  if (!python) {
    console.error('Python is not installed, so the design database cannot be searched. Use your own design judgement and say so.');
    return 3;
  }
  const cwd = realpathSync(process.cwd());
  const res = spawnSync(python, [script, ...searchArgs(argv, cwd)], {
    cwd,
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
    windowsHide: true,
    // The script prints emoji; a Windows console code page would make Python crash on them.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (res.error) {
    console.error(`Design search failed: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

/** Persona lines for an agent with the design database. Only loaded for that agent. */
export function designRules(tool: string): string[] {
  const run = `node "${tool}"`;
  return [
    '- You have a UI/UX design database. Use it only when the task changes how something looks or is used. Skip it for logic-only fixes, docs and questions.',
    `  New site, app or page: if design-system/*/MASTER.md exists, read it and follow it. Otherwise run once per project: ${run} "<product> <industry> <style>" --design-system --persist -p "<Project>"`,
    `  One specific concern: ${run} "<2-5 words>" --domain <ux|color|typography|style|landing|chart|icons>, or --stack <react|nextjs|vue|html-tailwind|...> for framework advice.`,
    '  At most 3 searches per job. Results are suggestions: if one finds nothing, say so and use your own judgement.',
  ];
}
