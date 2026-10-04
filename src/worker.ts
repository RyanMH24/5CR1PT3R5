import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { buildArgs, startClaude } from './claude.ts';
import type { OfficeConfig } from './config.ts';
import { canHandOff, handoffRules, parsePlan, planningPrompt, planSchema, takeHandoff, type Plan } from './delegate.ts';
import { designRules } from './design-search.ts';
import { Desks } from './desk.ts';
import { applyEvent, parseEventLine, parseResult } from './events.ts';
import { killTree } from './proc.ts';
import { buildPersona, DENY, getAgent } from './roster.ts';
import { dispatch, nextRunnable } from './scheduler.ts';
import { buildTeamIndex } from './team-index.ts';
import { JobStore } from './store.ts';
import type { Job, JobResult, JobState } from './types.ts';

const FLUSH_INTERVAL_MS = 1000;
const STDERR_TAIL_BYTES = 2000;

/**
 * Detached process that sits at one agent's desk and works through its queue, oldest first.
 * Exits when the queue is empty, so idle agents cost nothing.
 */
export async function runWorker(config: OfficeConfig, agentId: string): Promise<void> {
  const store = new JobStore(config.home);
  const desks = new Desks(config.home);
  const isCancelled = (id: number) => store.isCancelRequested(id);

  for (;;) {
    if (!desks.tryAcquire(agentId)) return; // another worker already serves this agent
    try {
      for (let job = claimNext(store, agentId); job; job = claimNext(store, agentId)) {
        await runJob(config, store, job);
        dispatch(config); // wake agents waiting on the job that just finished
      }
    } finally {
      desks.release(agentId);
    }
    // A job assigned while we were finishing saw the desk occupied and did not start a worker.
    // Look again now that the desk is free, or that job would sit in the queue forever.
    if (!nextRunnable(store.list(), agentId, isCancelled)) return;
  }
}

function claimNext(store: JobStore, agentId: string): Job | undefined {
  const job = nextRunnable(store.list(), agentId, (id) => store.isCancelRequested(id));
  if (!job) return undefined;
  return store.update(job.id, (j) => ({
    ...j,
    state: 'running',
    startedAt: new Date().toISOString(),
    workerPid: process.pid,
    progress: { ...j.progress, activity: 'Sitting down at the desk' },
  }));
}

async function runJob(config: OfficeConfig, store: JobStore, job: Job): Promise<void> {
  const log = createWriteStream(store.logPath(job.id), { flags: 'a' });
  const errLog = createWriteStream(store.stderrPath(job.id), { flags: 'a' });
  let progress = job.progress;
  let dirty = false;
  let result: JobResult | undefined;
  let resultSubtype = '';
  let structured: unknown;
  let stderrTail = '';
  let cancelled = false;
  let timedOut = false;
  let pid: number | undefined;
  const startedAt = Date.now();

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    store.update(job.id, (j) => ({ ...j, progress }));
  };

  const timer = setInterval(() => {
    flush();
    if (!pid || cancelled || timedOut) return;
    if (store.isCancelRequested(job.id)) {
      cancelled = true;
      killTree(pid);
    } else if (Date.now() - startedAt > config.jobTimeoutMs) {
      timedOut = true;
      killTree(pid);
    }
  }, FLUSH_INTERVAL_MS);

  let state: JobState = 'failed';
  let error: string | undefined;
  try {
    mkdirSync(job.workspace, { recursive: true });
    const agent = getAgent(job.agentId);
    const isPlan = job.kind === 'plan';
    const leads = canHandOff(job);
    // Reviewers can open every agent's folder, and are told where each piece of work lives.
    const reviewer = !isPlan && agent.seesAllWork === true;
    if (reviewer) mkdirSync(config.projectsDir, { recursive: true });
    const prompt = isPlan ? planningPrompt(job.task)
      : reviewer ? `${job.task}\n\n---\n${buildTeamIndex(store.list(), job, config.projectsDir)}`
      : job.task;
    const claude = startClaude({
      bin: config.claudeBin,
      cwd: job.workspace,
      prompt,
      args: buildArgs({
        model: job.model,
        effort: agent.effort,
        budgetUsd: job.budgetUsd,
        sessionId: job.sessionId,
        resume: job.resume,
        name: `office #${job.id} ${agent.name}`,
        tools: isPlan ? [] : agent.tools,
        allow: isPlan ? [] : agent.allow,
        deny: isPlan ? [] : DENY,
        addDirs: reviewer ? [config.projectsDir] : [],
        appendSystemPrompt: isPlan ? undefined : buildPersona(agent, config.runScript, config.projectsDir, [
          ...(leads ? handoffRules() : []),
          ...(agent.designSearch ? designRules(config.designSearch) : []),
        ]),
        jsonSchema: isPlan ? planSchema() : undefined,
      }),
      onLine: (line) => {
        log.write(`${line}\n`);
        const event = parseEventLine(line);
        if (!event) return;
        progress = applyEvent(progress, event, job.workspace);
        dirty = true;
        const parsed = parseResult(event);
        if (parsed) {
          result = parsed;
          resultSubtype = typeof event.subtype === 'string' ? event.subtype : '';
          structured = event.structured_output;
        }
      },
      onStderr: (chunk) => {
        errLog.write(chunk);
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
      },
    });
    pid = claude.pid;
    const exitCode = await claude.done;

    if (cancelled) {
      state = 'cancelled';
    } else if (timedOut) {
      error = `Timed out after ${Math.round(config.jobTimeoutMs / 60_000)} minutes`;
    } else if (result && !result.isError) {
      state = 'done';
      if (isPlan) result = { ...result, summary: createSubtasks(store, job, parsePlan(structured, result.summary)) };
      else if (leads) result = { ...result, summary: bringInTeam(store, job, result.summary) };
    } else if (result) {
      error = describeFailure(resultSubtype, result.summary);
    } else {
      error = `Claude Code exited with code ${exitCode}${stderrTail.trim() ? `: ${lastLines(stderrTail)}` : ''}`;
    }
  } catch (err) {
    state = 'failed';
    error = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? `Could not start Claude Code at "${config.claudeBin}". Run \`office doctor\`.`
      : (err as Error).message;
  } finally {
    clearInterval(timer);
    await Promise.all([closeStream(log), closeStream(errLog)]);
  }

  store.update(job.id, (j) => ({
    ...j,
    state,
    progress: { ...progress, activity: state === 'done' ? 'Finished' : progress.activity },
    finishedAt: new Date().toISOString(),
    result,
    error,
  }));
}

/**
 * Queue the teammates the Tech Lead asked for in her handoff file. Her own work is already done,
 * so a bad handoff is reported in her summary instead of failing her job.
 */
function bringInTeam(store: JobStore, leadJob: Job, summary: string): string {
  try {
    const plan = takeHandoff(leadJob.workspace);
    return plan ? `${summary}\n\nBrought in: ${createSubtasks(store, leadJob, plan)}` : summary;
  } catch (err) {
    return `${summary}\n\nCould not bring the team in: ${(err as Error).message}`;
  }
}

/** Turn a Tech Lead plan into queued jobs in the same folder. Returns the plan summary. */
function createSubtasks(store: JobStore, planJob: Job, plan: Plan): string {
  const created: Job[] = [];
  for (const sub of plan.subtasks) {
    const agent = getAgent(sub.agent);
    created.push(store.create({
      kind: 'task',
      agentId: agent.id,
      task: sub.task,
      workspace: planJob.workspace,
      model: agent.model,
      budgetUsd: agent.budgetUsd,
      dependsOn: sub.dependsOn.map((i) => created[i].id),
      planId: planJob.id,
      sessionId: randomUUID(),
    }));
  }
  const lines = created.map((j) => `#${j.id} ${getAgent(j.agentId).name}: ${j.task.split('\n')[0]}`);
  return [plan.summary, ...lines].filter(Boolean).join('\n');
}

function describeFailure(subtype: string, summary: string): string {
  if (subtype.includes('budget')) return 'Stopped at its budget cap. Raise it with --budget or reply to continue.';
  if (subtype.includes('max_turns')) return 'Ran out of turns. Reply to let it continue.';
  return summary || `Claude Code reported an error (${subtype || 'unknown'})`;
}

function lastLines(text: string, count = 3): string {
  return text.trim().split(/\r?\n/).slice(-count).join(' | ');
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}
