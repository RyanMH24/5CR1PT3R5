import { spawn, spawnSync } from 'node:child_process';
import { accessSync, appendFileSync, closeSync, constants, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as actions from './actions.ts';
import { loadConfig, type OfficeConfig } from './config.ts';
import { findSearchScript } from './design-search.ts';
import { Desks } from './desk.ts';
import { describeTool, parseEventLine, parseResult } from './events.ts';
import { c, fit, formatCost, modelLabel, oneLine, pad, renderBoard, renderJobDetail, renderJobTable } from './render.ts';
import { getAgent, ROSTER, TEAMS } from './roster.ts';
import { reconcile } from './scheduler.ts';
import { JobStore } from './store.ts';
import { ACTIVE_STATES, type Job } from './types.ts';
import { startUiServer, type UiServer } from './ui-server.ts';
import { runWorker } from './worker.ts';

const HELP = `${c.bold('5CR1PT3R5')} — a team of Claude agents that write code and scripts for you.

${c.bold('Usage')}
  office roster                              Who works here, their model and what they're doing
  office assign <agent> "<task>" [options]   Give one agent a job, in plain English
  office delegate "<big request>" [options]  Tech Lead plans it and splits it across the team
  office ui [--port 4777] [--no-open]        Pixel-art office in your browser, live
  office board                               Live view of the whole office (Ctrl+C to leave)
  office status [job] [--all] [--json]       Job list, or the full card for one job
  office logs <job> [-f]                     What the agent did, step by step (-f follows)
  office reply <job> "<message>" [-m model]  Follow up with the agent; it keeps its context
  office cancel <job>                        Stop a queued or running job
  office doctor                              Check that Claude Code and the shells are set up

${c.bold('Options')}
  -p, --project <name|path>  Folder to work in (default: a new folder in Projects/ named after the task)
  -m, --model <model>        haiku | sonnet | opus (default: the agent's own tier)
  -b, --budget <usd>         Spend cap for the job (default: the agent's own cap)
  -a, --after <ids>          Start only after these jobs finish, e.g. --after 3,4

${c.bold('Examples')}
  office assign powershell "Script that backs up Documents to D:\\Backup, keeping 7 days"
  office assign zsh "Script that cleans node_modules folders older than 30 days" -p dev-cleanup
  office delegate "Todo web app with a Node API, SQLite storage and tests"
  office reply 4 "Add a --dry-run switch"`;

/** Bad input; exits with code 2. Action validation errors count as usage errors too. */
class UsageError extends actions.ActionError {}

const OPTIONS = {
  project: { type: 'string', short: 'p' },
  model: { type: 'string', short: 'm' },
  budget: { type: 'string', short: 'b' },
  after: { type: 'string', short: 'a' },
  follow: { type: 'boolean', short: 'f' },
  all: { type: 'boolean' },
  json: { type: 'boolean' },
  port: { type: 'string' },
  'no-open': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function parse(args: string[]) {
  try {
    return parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;
  const config = loadConfig();
  try {
    switch (command) {
      case 'roster': case 'agents': return cmdRoster(config);
      case 'assign': return cmdAssign(config, rest);
      case 'delegate': return cmdDelegate(config, rest);
      case 'status': case 'st': return cmdStatus(config, rest);
      case 'ui': return await cmdUi(config, rest);
      case 'board': case 'watch': return await cmdBoard(config);
      case 'logs': return await cmdLogs(config, rest);
      case 'reply': return cmdReply(config, rest);
      case 'cancel': return cmdCancel(config, rest);
      case 'doctor': return cmdDoctor(config);
      case 'help': case '--help': case '-h': console.log(HELP); return 0;
      case '__worker': return await workerEntry(config, rest[0]);
      case '__complete': return cmdComplete(config, rest[0]);
      default: throw new UsageError(`Unknown command "${command}". Run \`office help\`.`);
    }
  } catch (err) {
    console.error(c.red(`✗ ${(err as Error).message}`));
    return err instanceof actions.ActionError ? 2 : 1;
  }
}

// ── commands ────────────────────────────────────────────────────────────────

function cmdRoster(config: OfficeConfig): number {
  const jobs = reconcile(new JobStore(config.home));
  for (const team of TEAMS) {
    console.log(c.bold(`\n ${team.toUpperCase()}`));
    console.log(c.dim(`${pad('', 2)}${pad('NAME', 8)}${pad('ID', 12)}${pad('ROLE', 25)}${pad('MODEL', 8)}${pad('CAP', 7)}STATUS`));
    for (const a of ROSTER.filter((agent) => agent.team === team)) {
      const running = jobs.find((j) => j.agentId === a.id && j.state === 'running');
      const queued = jobs.filter((j) => j.agentId === a.id && j.state === 'queued').length;
      const status = running ? c.green(`working on #${running.id}`) : queued ? c.yellow(`${queued} queued`) : c.dim('idle');
      console.log(`${pad('', 2)}${pad(c.bold(a.name), 8)}${pad(a.id, 12)}${pad(a.title, 25)}${pad(modelLabel(a.model), 8)}${pad(formatCost(a.budgetUsd), 7)}${status}`);
    }
  }
  console.log(c.dim('\n  Models: haiku = cheapest (scripting, web, docs) · sonnet = engineering & compiled languages · opus = planning & security'));
  console.log(c.dim('  Use the id, name or an alias: office assign js "…", office assign c# "…", office assign dana "…"'));
  return 0;
}

function cmdAssign(config: OfficeConfig, args: string[]): number {
  const { values, positionals } = parse(args);
  const [who, ...words] = positionals;
  const task = words.join(' ').trim();
  if (!who || !task) throw new UsageError('Usage: office assign <agent> "<task in plain English>" [-p project] [-m model] [-b usd] [-a ids]');
  const job = actions.assign(config, new JobStore(config.home), { agent: who, task, ...values });
  const agent = getAgent(job.agentId);
  printQueued(job, `${agent.name} (${agent.title})`);
  return 0;
}

function cmdDelegate(config: OfficeConfig, args: string[]): number {
  const { values, positionals } = parse(args);
  const task = positionals.join(' ').trim();
  if (!task) throw new UsageError('Usage: office delegate "<big request in plain English>" [-p project]');
  const job = actions.delegate(config, new JobStore(config.home), { task, ...values });
  const lead = getAgent(job.agentId);
  printQueued(job, `${lead.name} (${lead.title}) to plan`);
  console.log(c.dim('  Subtasks are queued for the right agents automatically when the plan is ready.'));
  return 0;
}

function cmdStatus(config: OfficeConfig, args: string[]): number {
  const { values, positionals } = parse(args);
  const store = new JobStore(config.home);
  const jobs = reconcile(store);
  if (positionals[0]) {
    const job = actions.requireJob(store, positionals[0]);
    console.log(values.json ? JSON.stringify(job, null, 2) : renderJobDetail(job, jobs));
    return 0;
  }
  const active = jobs.filter((j) => ACTIVE_STATES.includes(j.state));
  const finished = jobs.filter((j) => !ACTIVE_STATES.includes(j.state));
  const shown = values.all ? jobs : [...finished.slice(-10), ...active];
  if (values.json) {
    console.log(JSON.stringify(shown, null, 2));
    return 0;
  }
  console.log(renderJobTable(shown, termWidth()));
  if (!values.all && finished.length > 10) console.log(c.dim(`  … ${finished.length - 10} older jobs hidden (--all)`));
  return 0;
}

async function cmdBoard(config: OfficeConfig): Promise<number> {
  const store = new JobStore(config.home);
  if (!process.stdout.isTTY) {
    console.log(renderBoard(reconcile(store), 120));
    return 0;
  }
  const seenFinished = new Set(store.list().filter((j) => j.finishedAt).map((j) => j.id));
  let tick = 0;
  const draw = () => {
    // Reconcile occasionally: it is what notices crashed workers, but it costs a full scan + writes.
    const jobs = tick++ % 5 === 0 ? reconcile(store) : store.list();
    const newlyFinished = jobs.filter((j) => j.finishedAt && !seenFinished.has(j.id));
    newlyFinished.forEach((j) => seenFinished.add(j.id));
    const frame = renderBoard(jobs, termWidth()) + `\n\n${c.dim(' Ctrl+C to leave · office status <job> for details')}`;
    const bell = newlyFinished.length ? '\x07' : '';
    process.stdout.write(`\x1b[H${frame.split('\n').map((l) => `${l}\x1b[K`).join('\n')}\x1b[J${bell}`);
  };
  process.stdout.write('\x1b[?1049h\x1b[?25l'); // alternate screen, hide cursor
  draw();
  const timer = setInterval(draw, 1000);
  await new Promise<void>((done) => process.once('SIGINT', done));
  clearInterval(timer);
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  return 0;
}

async function cmdUi(config: OfficeConfig, args: string[]): Promise<number> {
  const { values } = parse(args);
  const port = values.port === undefined ? 4777 : Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError('--port must be between 1024 and 65535');
  let server: UiServer;
  try {
    server = await startUiServer(config, port);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is busy. Is \`office ui\` already running? Try --port ${port + 1}.`);
    }
    throw err;
  }
  console.log(`${c.green('●')} The office is open at ${c.bold(server.url)}  ${c.dim('(Ctrl+C to close)')}`);
  if (!values['no-open']) openBrowser(server.url);
  await new Promise<void>((done) => process.once('SIGINT', done));
  await server.close();
  return 0;
}

function openBrowser(url: string): void {
  // explorer.exe hands URLs to the default browser without cmd.exe quoting pitfalls.
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {
    console.log(c.dim(`  Could not open a browser; visit ${url}`));
  }).unref();
}

async function cmdLogs(config: OfficeConfig, args: string[]): Promise<number> {
  const { values, positionals } = parse(args);
  if (!positionals[0]) throw new UsageError('Usage: office logs <job> [-f]');
  const store = new JobStore(config.home);
  const job = actions.requireJob(store, positionals[0]);
  const path = store.logPath(job.id);
  let offset = 0;
  let pending = '';

  const pump = () => {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size <= offset) return;
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const lines = (pending + buf.toString('utf8')).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const text = renderLogLine(line, job.workspace);
        if (text) console.log(text);
      }
    } finally {
      closeSync(fd);
    }
  };

  pump();
  if (!values.follow) {
    if (offset === 0) console.log(c.dim(`No activity yet for job #${job.id} (${job.state}).`));
    return 0;
  }
  let stop = false;
  process.once('SIGINT', () => { stop = true; });
  while (!stop) {
    await new Promise((r) => setTimeout(r, 500));
    pump();
    const latest = store.get(job.id);
    if (latest && !ACTIVE_STATES.includes(latest.state)) {
      pump();
      console.log(c.dim(`— job #${job.id} ${latest.state}`));
      break;
    }
  }
  return 0;
}

function cmdReply(config: OfficeConfig, args: string[]): number {
  const { values, positionals } = parse(args);
  const [ref, ...words] = positionals;
  const message = words.join(' ').trim();
  if (!ref || !message) throw new UsageError('Usage: office reply <job> "<message>" [-m model]');
  const job = actions.reply(config, new JobStore(config.home), { job: ref, message, model: values.model, budget: values.budget });
  printQueued(job, `${getAgent(job.agentId).name}, continuing the conversation`);
  return 0;
}

function cmdCancel(config: OfficeConfig, args: string[]): number {
  const { positionals } = parse(args);
  if (!positionals[0]) throw new UsageError('Usage: office cancel <job>');
  const { job, cancelled, wasRunning } = actions.cancel(new JobStore(config.home), positionals[0]);
  if (!cancelled) {
    console.log(c.dim(`Job #${job.id} is already ${job.state}.`));
    return 0;
  }
  console.log(wasRunning
    ? `${c.yellow('■')} Stopping job #${job.id}; ${getAgent(job.agentId).name} will put it down within a second.`
    : `${c.yellow('■')} Cancelled job #${job.id}.`);
  return 0;
}

function cmdDoctor(config: OfficeConfig): number {
  const ok = (label: string, detail: string) => console.log(`${c.green('✓')} ${pad(label, 14)} ${detail}`);
  const warn = (label: string, detail: string) => console.log(`${c.yellow('!')} ${pad(label, 14)} ${detail}`);
  const bad = (label: string, detail: string) => console.log(`${c.red('✗')} ${pad(label, 14)} ${detail}`);
  let healthy = true;

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 18)) ok('node', process.versions.node);
  else { bad('node', `${process.versions.node}; need 22.18+ (runs TypeScript natively)`); healthy = false; }

  const claude = probe(config.claudeBin, ['--version']);
  if (claude) ok('claude', `${claude}  ${c.dim(config.claudeBin)}`);
  else { bad('claude', `not found at "${config.claudeBin}". Install Claude Code or set OFFICE_CLAUDE_BIN.`); healthy = false; }

  const psVersion = ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'];
  const shells: Array<[string, string, string[], string]> = process.platform === 'win32' ? [
    ['git', 'git', ['--version'], 'needed by Claude Code\'s Bash tool on Windows'],
    ['powershell', 'powershell.exe', psVersion, 'the PowerShell scripter can write but not test scripts'],
    ['pwsh (7+)', 'pwsh', psVersion, 'optional; Windows PowerShell 5.1 is used instead'],
    ['zsh', 'zsh', ['--version'], 'the Zsh scripter falls back to bash -n for syntax checks'],
    ['python', 'python', ['--version'], 'the Python specialist can write but not run scripts'],
  ] : [
    ['git', 'git', ['--version'], 'agents cannot make local commits'],
    ['pwsh', 'pwsh', psVersion, 'the PowerShell scripter can write but not test scripts (brew install --cask powershell)'],
    ['zsh', 'zsh', ['--version'], 'the Zsh scripter falls back to bash -n for syntax checks'],
    ['python3', 'python3', ['--version'], 'the Python specialist can write but not run scripts'],
  ];
  // Language toolchains: missing ones only mean that specialist can write but not build/run.
  const toolchains: Array<[string, string, string[]]> = [
    ['java', 'javac', ['-version']], ['dotnet (C#)', 'dotnet', ['--version']], ['go', 'go', ['version']],
    ['gcc (C)', 'gcc', ['--version']], ['g++ (C++)', 'g++', ['--version']], ['cargo (Rust)', 'cargo', ['--version']],
    ['php', 'php', ['--version']], ['ruby', 'ruby', ['--version']], ['swift', 'swift', ['--version']],
    ['kotlin', 'kotlinc', ['-version']],
  ];
  for (const [label, bin, args] of toolchains) shells.push([label, bin, args, 'that specialist can write code but not build or run it']);
  for (const [label, bin, args, impact] of shells) {
    const version = probe(bin, args);
    if (version) ok(label, version);
    else warn(label, `not found: ${impact}`);
  }

  const designDb = findSearchScript();
  if (designDb) ok('design db', `ui-ux-pro-max, used by ${ROSTER.filter((a) => a.designSearch).map((a) => a.name).join(', ')}  ${c.dim(designDb)}`);
  else warn('design db', 'ui-ux-pro-max not installed: the frontend agent designs without it (claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill)');

  try {
    accessSync(config.projectsDir, constants.W_OK);
    ok('projects', config.projectsDir);
  } catch {
    bad('projects', `${config.projectsDir} is not writable`);
    healthy = false;
  }
  console.log(c.dim(`  state: ${config.home}`));
  return healthy ? 0 : 1;
}

/** Machine-readable lists for the zsh and PowerShell completion scripts. */
function cmdComplete(config: OfficeConfig, what: string | undefined): number {
  if (what === 'agents') {
    for (const a of ROSTER) console.log(`${a.id}:${a.name}, ${a.title} (${a.model})`);
  } else if (what === 'jobs') {
    for (const j of new JobStore(config.home).list().slice(-30).reverse()) {
      console.log(`${j.id}:${j.state} ${getAgent(j.agentId).name} - ${oneLine(j.task).slice(0, 50).replaceAll(':', ' ')}`);
    }
  }
  return 0;
}

async function workerEntry(config: OfficeConfig, agentId: string | undefined): Promise<number> {
  if (!agentId) return 2;
  try {
    await runWorker(config, agentId);
    return 0;
  } catch (err) {
    // A detached worker has no terminal, so leave a trace where `office doctor` users can find it.
    appendFileSync(join(config.home, 'worker-errors.log'), `${new Date().toISOString()} [${agentId}] ${(err as Error).stack}\n`);
    new Desks(config.home).release(agentId);
    return 1;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function printQueued(job: Job, who: string): void {
  console.log(`${c.green('✓')} Job ${c.bold(`#${job.id}`)} → ${who} · ${modelLabel(job.model)} · cap ${formatCost(job.budgetUsd)}`);
  console.log(c.dim(`  folder: ${job.workspace}`));
  if (job.dependsOn.length) console.log(c.dim(`  starts after: ${job.dependsOn.map((d) => `#${d}`).join(', ')}`));
  console.log(c.dim(`  track it: office status ${job.id}  ·  office logs ${job.id} -f  ·  office board`));
}

function renderLogLine(line: string, workspace: string): string | undefined {
  const event = parseEventLine(line);
  if (!event) return undefined;
  if (event.type === 'system' && event.subtype === 'init') return c.dim(`— session started on ${String(event.model)}`);
  if (event.type === 'system' && event.subtype === 'permission_denied') {
    return c.yellow(`  ! blocked: ${String(event.tool_name)}`);
  }
  const result = parseResult(event);
  if (result) {
    // The report itself was already printed as the agent's last message.
    const summary = `${result.isError ? '✗ stopped' : '✓ finished'} · ${formatCost(result.costUsd)} · ${result.turns} turns`;
    return result.isError ? c.red(summary) : c.green(summary);
  }
  const message = event.message as { content?: unknown } | undefined;
  const blocks = Array.isArray(message?.content) ? (message.content as Array<Record<string, unknown>>) : [];
  const out: string[] = [];
  for (const b of blocks) {
    if (event.type === 'assistant' && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      out.push(`${c.cyan('»')} ${b.text.trim()}`);
    } else if (event.type === 'assistant' && b.type === 'tool_use' && typeof b.name === 'string') {
      out.push(c.dim(`  → ${describeTool(b.name, (b.input ?? {}) as Record<string, unknown>, workspace)}`));
    } else if (event.type === 'user' && b.type === 'tool_result' && b.is_error === true) {
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      if (!text.startsWith('Permission for this tool use was denied')) out.push(c.red(`    ✗ ${fit(oneLine(text), 140)}`));
    }
  }
  return out.length ? out.join('\n') : undefined;
}

function probe(bin: string, args: string[]): string | undefined {
  const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (res.error || res.status !== 0) return undefined;
  return res.stdout.trim().split(/\r?\n/)[0] || undefined;
}

function termWidth(): number {
  return process.stdout.columns || 120;
}
