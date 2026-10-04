import { isAbsolute, relative } from 'node:path';
import type { JobResult, Progress, TodoItem } from './types.ts';

/**
 * Pure reducers over Claude Code's `--output-format stream-json` events. Kept free of I/O so the
 * worker, the log viewer and the tests all share one interpretation of the stream.
 */

const FILE_WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const MAX_BLOCKED = 10;

type Json = Record<string, unknown>;

export function emptyProgress(): Progress {
  return { activity: 'Waiting for a desk', todos: [], filesTouched: [], toolCalls: 0, turns: 0, blocked: [] };
}

export function parseEventLine(line: string): Json | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function applyEvent(progress: Progress, event: Json, workspace: string): Progress {
  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') return { ...progress, activity: 'Reading the task' };
      if (event.subtype === 'permission_denied') {
        const what = typeof event.tool_name === 'string' ? event.tool_name : 'a tool';
        const reason = blockedReason(event.message);
        const blocked = [...progress.blocked, reason ? `${what}: ${reason}` : what].slice(-MAX_BLOCKED);
        return { ...progress, blocked };
      }
      return progress;
    case 'assistant':
      return applyAssistant(progress, event, workspace);
    case 'result':
      return { ...progress, activity: event.is_error === true ? 'Stopped with an error' : 'Finished' };
    default:
      return progress;
  }
}

function applyAssistant(progress: Progress, event: Json, workspace: string): Progress {
  const content = isObject(event.message) && Array.isArray(event.message.content) ? event.message.content : [];
  let next: Progress = { ...progress, turns: progress.turns + 1 };
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      next = { ...next, lastText: block.text.trim() };
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const input = isObject(block.input) ? block.input : {};
      next = { ...next, toolCalls: next.toolCalls + 1, activity: describeTool(block.name, input, workspace) };
      if (block.name === 'TodoWrite') next = { ...next, todos: parseTodos(input.todos) };
      if (FILE_WRITING_TOOLS.has(block.name) && typeof input.file_path === 'string') {
        const file = displayPath(input.file_path, workspace);
        if (!next.filesTouched.includes(file)) next = { ...next, filesTouched: [...next.filesTouched, file] };
      }
    }
  }
  return next;
}

export function parseResult(event: Json): JobResult | undefined {
  if (event.type !== 'result') return undefined;
  return {
    summary: typeof event.result === 'string' ? event.result.trim() : '',
    costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0,
    durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : 0,
    turns: typeof event.num_turns === 'number' ? event.num_turns : 0,
    isError: event.is_error === true || event.subtype !== 'success',
  };
}

/** One-line, human description of a tool call, e.g. `Editing src/app.ts`. */
export function describeTool(name: string, input: Json, workspace: string): string {
  const file = typeof input.file_path === 'string' ? displayPath(input.file_path, workspace) : '';
  switch (name) {
    case 'Read': return `Reading ${file}`;
    case 'Write': return `Writing ${file}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${file}`;
    case 'Glob':
    case 'Grep': return 'Searching the code';
    case 'TodoWrite': {
      const current = parseTodos(input.todos).find((t) => t.status === 'in_progress');
      return current ? current.activeForm ?? current.content : 'Updating the plan';
    }
    case 'Bash':
    case 'PowerShell': {
      const command = typeof input.command === 'string' ? input.command : '';
      // Agents often prefix `cd "<their folder>" &&`; it is noise when you are watching.
      const meaningful = command
        .replace(/^\s*(?:cd|Set-Location)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i, '')
        .replace(/^\s*&\s+/, '');
      const runner = /run-script\.mjs["']?\s+(check|run)\s+("[^"]*"|'[^']*'|\S+)/.exec(meaningful);
      if (runner) return `${runner[1] === 'check' ? 'Checking' : 'Running'} ${baseName(unquote(runner[2]))}`;
      // Absolute paths are long and say little; the file name is what matters.
      const short = meaningful.replace(/"([A-Za-z]:[\\/][^"]*|\/[^"]*)"/g, (_m, p: string) => baseName(p));
      return `Running: ${oneLine(short)}`;
    }
    default: return `Using ${name}`;
  }
}

export function todoCounts(todos: TodoItem[]): { done: number; total: number; current?: TodoItem } {
  return {
    done: todos.filter((t) => t.status === 'completed').length,
    total: todos.length,
    current: todos.find((t) => t.status === 'in_progress'),
  };
}

function parseTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((t): TodoItem[] => {
    if (typeof t.content !== 'string') return [];
    const status = t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending';
    return [{ content: t.content, status, activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined }];
  });
}

/** Show workspace files relative to the task folder; anything else stays absolute. */
function displayPath(file: string, workspace: string): string {
  const rel = relative(workspace, file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replaceAll('\\', '/') : file;
}

const unquote = (text: string) => text.replace(/^["']|["']$/g, '');
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function blockedReason(message: unknown): string {
  if (typeof message !== 'string') return '';
  const marker = 'What required approval:';
  const at = message.indexOf(marker);
  return at === -1 ? '' : oneLine(message.slice(at + marker.length));
}

function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
