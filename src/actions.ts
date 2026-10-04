import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, join, parse as parsePath, resolve } from 'node:path';
import { attachmentNote, decodeAttachments, saveAttachments } from './attachments.ts';
import type { OfficeConfig } from './config.ts';
import { ActionError } from './errors.ts';
import { findAgent, getAgent, ROSTER } from './roster.ts';
import { dispatch, reconcile } from './scheduler.ts';
import type { JobStore } from './store.ts';
import { ACTIVE_STATES, type Job } from './types.ts';

/**
 * The things a person can ask the office to do, shared by the CLI and the web page so both
 * validate input the same way. Every function takes plain-English task text as-is.
 * Bad input throws ActionError, whose message is safe to show to the user.
 */

export { ActionError };

export const MAX_TASK_CHARS = 20_000;
const PLAN_BUDGET_USD = 1; // a plan is one short, tool-free call

export interface AssignInput {
  agent: string;
  task: string;
  project?: string;
  model?: string;
  budget?: string | number;
  after?: string;
  /** Images from the page, saved in the task folder before the agent starts. */
  attachments?: unknown;
}

export function assign(config: OfficeConfig, store: JobStore, input: AssignInput): Job {
  const agent = findAgent(input.agent ?? '');
  if (!agent) throw new ActionError(`No agent called "${input.agent}". Choose one of: ${ROSTER.map((a) => a.id).join(', ')}`);
  const task = cleanTask(input.task);
  const workspace = resolveWorkspace(config, input.project, task);
  const job = store.create({
    kind: 'task',
    agentId: agent.id,
    task: task + attachTo(workspace, input.attachments),
    workspace,
    model: parseModel(input.model) ?? agent.model,
    budgetUsd: parseBudget(input.budget) ?? agent.budgetUsd,
    dependsOn: parseAfter(store, input.after),
    sessionId: randomUUID(),
  });
  dispatch(config);
  return job;
}

export type DelegateInput = Omit<AssignInput, 'agent'>;

/** Hand a big request to the Tech Lead, who splits it across the team. */
export function delegate(config: OfficeConfig, store: JobStore, input: DelegateInput): Job {
  const lead = getAgent('tech-lead');
  const task = cleanTask(input.task);
  const workspace = resolveWorkspace(config, input.project, task);
  const job = store.create({
    kind: 'plan',
    agentId: lead.id,
    // The plan and every subtask share this folder, so the whole team can use the images.
    task: task + attachTo(workspace, input.attachments),
    workspace,
    model: parseModel(input.model) ?? lead.model,
    budgetUsd: parseBudget(input.budget) ?? PLAN_BUDGET_USD,
    dependsOn: parseAfter(store, input.after),
    sessionId: randomUUID(),
  });
  dispatch(config);
  return job;
}

export interface ReplyInput {
  job: string | number;
  message: string;
  model?: string;
  budget?: string | number;
  attachments?: unknown;
}

/** Follow up on a finished job; the agent continues the same conversation and folder. */
export function reply(config: OfficeConfig, store: JobStore, input: ReplyInput): Job {
  const original = requireJob(store, input.job);
  if (original.kind === 'plan') throw new ActionError('Plans cannot be replied to. Reply to one of its subtasks, or delegate again.');
  if (ACTIVE_STATES.includes(original.state)) throw new ActionError(`Job #${original.id} is still ${original.state}. Reply once it finishes.`);
  if (!original.startedAt) throw new ActionError(`Job #${original.id} never started, so there is no conversation to continue.`);
  const agent = getAgent(original.agentId);
  const job = store.create({
    kind: 'task',
    agentId: agent.id,
    task: cleanTask(input.message) + attachTo(original.workspace, input.attachments),
    workspace: original.workspace,
    model: parseModel(input.model) ?? original.model,
    budgetUsd: parseBudget(input.budget) ?? agent.budgetUsd,
    sessionId: original.sessionId,
    resume: true,
  });
  dispatch(config);
  return job;
}

export interface CancelResult {
  job: Job;
  /** False when the job had already finished. */
  cancelled: boolean;
  wasRunning: boolean;
}

export function cancel(store: JobStore, ref: string | number): CancelResult {
  const job = requireJob(store, ref);
  if (!ACTIVE_STATES.includes(job.state)) return { job, cancelled: false, wasRunning: false };
  store.requestCancel(job.id);
  reconcile(store); // settles queued jobs now; a running job is stopped by its worker
  return { job, cancelled: true, wasRunning: job.state === 'running' };
}

export function requireJob(store: JobStore, ref: string | number): Job {
  const id = typeof ref === 'number' ? ref : Number(String(ref).trim().replace(/^#/, ''));
  if (!Number.isInteger(id) || id <= 0) throw new ActionError(`"${ref}" is not a job number`);
  const job = store.get(id);
  if (!job) throw new ActionError(`Job #${id} not found. See \`office status\`.`);
  return job;
}

export function parseModel(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const model = value.trim().toLowerCase();
  if (['haiku', 'sonnet', 'opus', 'fable'].includes(model) || /^claude-[a-z0-9.-]+$/.test(model)) return model;
  throw new ActionError(`Unknown model "${value}". Use haiku, sonnet, opus or a full claude-* id.`);
}

export function parseBudget(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const usd = typeof value === 'number' ? value : Number(value.replace(/^\$/, ''));
  if (!Number.isFinite(usd) || usd <= 0 || usd > 50) throw new ActionError('The budget must be a dollar amount between 0 and 50');
  return usd;
}

function parseAfter(store: JobStore, value: string | undefined): number[] {
  if (!value) return [];
  return value.split(',').map((ref) => requireJob(store, ref.trim()).id);
}

/** Save attached images in the task folder and return the note telling the agent about them. */
function attachTo(workspace: string, raw: unknown): string {
  const files = decodeAttachments(raw); // validate everything before writing anything
  return attachmentNote(saveAttachments(workspace, files));
}

function cleanTask(text: string | undefined): string {
  const task = (text ?? '').trim();
  if (!task) throw new ActionError('Describe what needs to be done.');
  if (task.length > MAX_TASK_CHARS) throw new ActionError(`That task is too long (max ${MAX_TASK_CHARS} characters).`);
  return task;
}

/**
 * Pick the folder an agent is confined to. By default every prompt gets a fresh folder in
 * Agents Work, named after the task. A bare `project` name reuses that folder in Agents Work;
 * a path (containing a slash) points at an existing folder, e.g. to work on a project elsewhere.
 */
export function resolveWorkspace(config: OfficeConfig, project: string | undefined, task: string): string {
  const name = project?.trim() || undefined;
  if (name && /[\\/]/.test(name)) {
    const dir = resolve(name);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new ActionError(`Folder not found: ${dir}`);
    const forbidden = [config.root, config.projectsDir, parsePath(dir).root].map((p) => resolve(p).toLowerCase());
    if (forbidden.includes(dir.toLowerCase())) throw new ActionError(`Agents can't work directly in ${dir}; pick a project folder.`);
    return dir;
  }
  const base = slugify(name ?? task) || 'task';
  // Slugs are lowercase; the office's own folder may not be (e.g. 5CR1PT3R5).
  if (base === basename(config.root).toLowerCase()) throw new ActionError(`"${base}" is the office's own folder; pick another name.`);
  if (name) return join(config.projectsDir, base); // explicit name: reuse it if it exists
  let dir = join(config.projectsDir, base);
  for (let n = 2; existsSync(dir); n++) dir = join(config.projectsDir, `${base}-${n}`);
  return dir;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'that', 'which', 'to', 'for', 'of', 'and', 'me', 'my', 'make', 'write', 'create', 'build', 'please', 'script', 'with', 'i', 'need', 'want', 'can', 'you']);
