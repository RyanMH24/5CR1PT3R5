import { todoCounts } from './events.ts';
import { getAgent, ROSTER } from './roster.ts';
import type { Job, JobState } from './types.ts';

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  magenta: paint('35'),
  cyan: paint('36'),
};

const STATE_STYLE: Record<JobState, { icon: string; color: (s: string) => string }> = {
  queued: { icon: '◌', color: c.yellow },
  running: { icon: '●', color: c.green },
  done: { icon: '✓', color: c.cyan },
  failed: { icon: '✗', color: c.red },
  cancelled: { icon: '■', color: c.dim },
  blocked: { icon: '⊘', color: c.red },
};

const MODEL_COLOR: Record<string, (s: string) => string> = { haiku: c.green, sonnet: c.blue, opus: c.magenta };

export function stateLabel(state: JobState): string {
  const { icon, color } = STATE_STYLE[state];
  return color(`${icon} ${state}`);
}

export function modelLabel(model: string): string {
  return (MODEL_COLOR[model] ?? c.dim)(model);
}

export function formatCost(usd: number): string {
  return usd >= 0.01 || usd === 0 ? `$${usd.toFixed(2)}` : '<$0.01';
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

export function elapsed(job: Job, now = Date.now()): string {
  if (!job.startedAt) return '';
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  return formatDuration(end - Date.parse(job.startedAt));
}

export function progressBar(done: number, total: number, width = 10): string {
  if (total === 0) return c.dim('·'.repeat(width));
  const filled = Math.round((done / total) * width);
  return c.green('█'.repeat(filled)) + c.dim('░'.repeat(width - filled));
}

const ANSI = /\x1b\[[0-9;]*m/g;
export const visibleLength = (s: string) => [...s.replace(ANSI, '')].length;

export function pad(text: string, width: number): string {
  const len = visibleLength(text);
  return len >= width ? text : text + ' '.repeat(width - len);
}

/** Truncate to a visible width, keeping ANSI codes intact. */
export function fit(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let out = '';
  let seen = 0;
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) { out += part; continue; }
    for (const ch of part) {
      if (seen >= width - 1) return `${out}…${useColor ? '\x1b[0m' : ''}`;
      out += ch;
      seen++;
    }
  }
  return out;
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The live office: one row per agent, then recent finished jobs. */
export function renderBoard(jobs: readonly Job[], width: number, now = Date.now()): string {
  const running = jobs.filter((j) => j.state === 'running');
  const queued = jobs.filter((j) => j.state === 'queued');
  const today = new Date(now).toDateString();
  const spentToday = jobs
    .filter((j) => j.finishedAt && new Date(j.finishedAt).toDateString() === today)
    .reduce((sum, j) => sum + (j.result?.costUsd ?? 0), 0);
  const idle = ROSTER.length - new Set([...running, ...queued].map((j) => j.agentId)).size;

  const out: string[] = [];
  out.push(`${c.bold(' 5CR1PT3R5')}  ${c.green(`${running.length} working`)} · ${c.yellow(`${queued.length} queued`)} · ${c.dim(`${idle} idle`)} · spent today ${formatCost(spentToday)}`);
  out.push(c.dim('─'.repeat(Math.min(width, 100))));

  for (const agent of ROSTER) {
    const current = running.find((j) => j.agentId === agent.id);
    const waiting = queued.filter((j) => j.agentId === agent.id).length;
    const who = `${pad(c.bold(agent.name), 7)} ${pad(c.dim(agent.title), 20)} ${pad(modelLabel(current?.model ?? agent.model), 7)}`;
    let line: string;
    if (current) {
      const { done, total } = todoCounts(current.progress.todos);
      const steps = total ? `${done}/${total}` : '   ';
      line = `${c.green('●')} ${who} ${c.bold(`#${current.id}`)} ${progressBar(done, total, 8)} ${pad(steps, 5)} ${pad(c.dim(elapsed(current, now)), 7)} ${current.progress.activity}`;
    } else if (waiting) {
      line = `${c.yellow('◌')} ${who} ${c.yellow(`${waiting} queued`)}`;
    } else {
      line = `${c.dim('○')} ${who} ${c.dim('idle')}`;
    }
    if (current && waiting) line += c.yellow(` (+${waiting} queued)`);
    out.push(fit(line, width));
  }

  const finished = jobs.filter((j) => j.finishedAt).sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!)).slice(0, 5);
  if (finished.length) {
    out.push('', c.bold(' RECENT'));
    for (const job of finished) {
      const cost = job.result ? formatCost(job.result.costUsd) : '';
      const head = `  ${pad(stateLabel(job.state), 12)} ${pad(c.bold(`#${job.id}`), 5)} ${pad(getAgent(job.agentId).name, 7)} ${pad(c.dim(cost), 6)}`;
      out.push(fit(`${head} ${oneLine(job.task)}`, width));
    }
  }
  return out.join('\n');
}

/** Compact table for `office status`. */
export function renderJobTable(jobs: readonly Job[], width: number): string {
  if (jobs.length === 0) return c.dim('No jobs yet. Try: office assign powershell "write a script that ..."');
  const header = c.dim(`${pad('JOB', 6)}${pad('AGENT', 8)}${pad('STATE', 13)}${pad('MODEL', 8)}${pad('TIME', 8)}${pad('COST', 7)}TASK / NOW`);
  const rows = jobs.map((job) => {
    const agent = getAgent(job.agentId);
    const detail = job.state === 'running' ? job.progress.activity : oneLine(job.task);
    const cost = job.result ? formatCost(job.result.costUsd) : '';
    return fit(`${pad(`#${job.id}`, 6)}${pad(agent.name, 8)}${pad(stateLabel(job.state), 13)}${pad(modelLabel(job.model), 8)}${pad(elapsed(job), 8)}${pad(cost, 7)}${detail}`, width);
  });
  return [header, ...rows].join('\n');
}

/** Full card for `office status <job>`. */
export function renderJobDetail(job: Job, jobs: readonly Job[] = []): string {
  const agent = getAgent(job.agentId);
  const p = job.progress;
  const out: string[] = [];
  out.push(`${c.bold(`Job #${job.id}`)}  ${stateLabel(job.state)}  ${agent.name}, ${agent.title} · ${modelLabel(job.model)}${job.kind === 'plan' ? c.dim(' · planning') : ''}`);
  out.push(`${c.dim('Task:   ')} ${job.task}`);
  out.push(`${c.dim('Folder: ')} ${job.workspace}`);
  const timing = [job.startedAt ? `ran ${elapsed(job)}` : 'not started', job.result ? formatCost(job.result.costUsd) : '', `budget ${formatCost(job.budgetUsd)}`];
  out.push(`${c.dim('Usage:  ')} ${timing.filter(Boolean).join(' · ')}`);
  if (job.dependsOn.length) out.push(`${c.dim('After:  ')} ${job.dependsOn.map((d) => `#${d}`).join(', ')}`);
  if (job.planId !== undefined) out.push(`${c.dim('From:   ')} Ava, job #${job.planId}`);
  if (job.state === 'running') out.push(`${c.dim('Now:    ')} ${c.green(p.activity)}`);

  if (p.todos.length) {
    const { done, total } = todoCounts(p.todos);
    out.push('', `${c.bold('Plan')} ${progressBar(done, total)} ${done}/${total}`);
    for (const t of p.todos) {
      const mark = t.status === 'completed' ? c.green('✓') : t.status === 'in_progress' ? c.yellow('▸') : c.dim('○');
      out.push(`  ${mark} ${t.status === 'completed' ? c.dim(t.content) : t.content}`);
    }
  }
  const team = jobs.filter((j) => j.planId === job.id);
  if (team.length) {
    out.push('', `${c.bold('Team')} ${c.dim(`${team.length} brought in`)}`);
    for (const t of team) out.push(`  ${pad(`#${t.id}`, 6)}${pad(getAgent(t.agentId).name, 8)}${pad(stateLabel(t.state), 13)}${oneLine(t.task)}`);
  }
  if (p.filesTouched.length) {
    out.push('', c.bold('Files'));
    for (const f of p.filesTouched) out.push(`  ${f}`);
  }
  if (p.blocked.length) {
    out.push('', c.yellow(c.bold('Blocked by the sandbox')));
    for (const b of p.blocked) out.push(c.yellow(`  ! ${b}`));
  }
  if (job.result?.summary && job.state !== 'failed') out.push('', c.bold('Report'), job.result.summary);
  if (job.error) out.push('', c.red(c.bold('Error')), c.red(job.error));
  return out.join('\n');
}
