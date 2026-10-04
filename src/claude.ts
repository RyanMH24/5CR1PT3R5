import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Effort, Model } from './types.ts';

export interface ClaudeRunSpec {
  model: Model;
  effort?: Effort;
  budgetUsd: number;
  sessionId: string;
  /** Continue `sessionId` instead of starting it. */
  resume: boolean;
  /** Display name for the session (shows in `claude --resume`). */
  name: string;
  /** Built-in tools to load. An empty list loads none (pure reasoning, cheapest). */
  tools: string[];
  allow: string[];
  deny: string[];
  /** Extra folders the file tools may use besides the working directory (`--add-dir`). */
  addDirs?: string[];
  appendSystemPrompt?: string;
  /** Request structured output matching this JSON Schema. */
  jsonSchema?: object;
}

/**
 * Translate a run spec into Claude Code flags.
 *
 * Sandbox: `--restricted` confines the file tools to the working directory, ignores user and
 * project settings, and removes command-running tools unless `--tools` names them.
 * `--permission-prompts none` denies anything not in the allowlist instead of waiting for a
 * person who is not there.
 * Token savings: no skills (`--disable-slash-commands`), no MCP servers (`--strict-mcp-config`),
 * only the tools the role needs, and a hard `--max-budget-usd` cap.
 */
export function buildArgs(spec: ClaudeRunSpec): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose', // required by stream-json in print mode
    '--model', spec.model,
    '--restricted',
    '--tools', spec.tools.join(','),
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--max-budget-usd', spec.budgetUsd.toFixed(2),
    '--name', spec.name,
  ];
  if (spec.addDirs?.length) args.push('--add-dir', ...spec.addDirs);
  if (spec.allow.length) args.push('--allowedTools', ...spec.allow);
  if (spec.deny.length) args.push('--disallowedTools', ...spec.deny);
  if (spec.effort) args.push('--effort', spec.effort);
  if (spec.appendSystemPrompt) args.push('--append-system-prompt', spec.appendSystemPrompt);
  if (spec.jsonSchema) args.push('--json-schema', JSON.stringify(spec.jsonSchema));
  args.push(spec.resume ? '--resume' : '--session-id', spec.sessionId);
  return args;
}

export interface ClaudeProcess {
  pid: number | undefined;
  /** Resolves with the exit code once the process and its output streams have closed. */
  done: Promise<number>;
}

/**
 * Start Claude Code. The prompt goes through stdin, not argv, so task text never needs shell
 * quoting and is not limited by the Windows command-line length.
 */
export function startClaude(opts: {
  bin: string;
  args: string[];
  prompt: string;
  cwd: string;
  onLine: (line: string) => void;
  onStderr: (chunk: string) => void;
}): ClaudeProcess {
  const child = spawn(opts.bin, opts.args, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32', // own process group so cancel can kill the tree
  });
  child.stdin.end(opts.prompt);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', opts.onStderr);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', opts.onLine);

  const done = new Promise<number>((resolve, reject) => {
    child.once('error', reject); // e.g. ENOENT when the CLI is not installed
    child.once('close', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });
  return { pid: child.pid, done };
}
