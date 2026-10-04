import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { OfficeConfig } from './config.ts';
import { Desks } from './desk.ts';
import { isAlive } from './proc.ts';
import { ROSTER } from './roster.ts';
import { JobStore } from './store.ts';
import type { Job } from './types.ts';

/**
 * There is no long-running daemon. Whenever something changes (a job is assigned, a job
 * finishes) the caller runs `dispatch`, which settles job states and starts a detached worker
 * for every agent that has runnable work and an empty desk.
 */

export type Readiness = 'ready' | 'waiting' | 'blocked';

/** Whether a queued job can start, given the jobs it depends on. */
export function readiness(job: Job, byId: ReadonlyMap<number, Job>): Readiness {
  let waiting = false;
  for (const depId of job.dependsOn) {
    const dep = byId.get(depId);
    if (!dep || dep.state === 'failed' || dep.state === 'cancelled' || dep.state === 'blocked') return 'blocked';
    if (dep.state !== 'done') waiting = true;
  }
  return waiting ? 'waiting' : 'ready';
}

/** The oldest queued, ready job for an agent. */
export function nextRunnable(jobs: readonly Job[], agentId: string, isCancelled: (id: number) => boolean): Job | undefined {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return jobs.find((j) => j.agentId === agentId && j.state === 'queued' && !isCancelled(j.id)
    && readiness(j, byId) === 'ready');
}

/**
 * Settle states that need no agent: cancel queued jobs with a cancel request, block jobs whose
 * dependencies failed, and fail running jobs whose worker died. Returns the refreshed list.
 */
export function reconcile(store: JobStore): Job[] {
  let jobs = store.list();
  let changed = true;
  // Loop because blocking one job can block the jobs that depend on it.
  while (changed) {
    changed = false;
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const job of jobs) {
      const now = new Date().toISOString();
      if (job.state === 'queued' && store.isCancelRequested(job.id)) {
        store.update(job.id, (j) => j.state === 'queued' ? { ...j, state: 'cancelled', finishedAt: now } : j);
        changed = true;
      } else if (job.state === 'queued' && readiness(job, byId) === 'blocked') {
        store.update(job.id, (j) => j.state === 'queued'
          ? { ...j, state: 'blocked', finishedAt: now, error: 'A job it depends on did not finish' } : j);
        changed = true;
      } else if (job.state === 'running' && !isAlive(job.workerPid)) {
        store.update(job.id, (j) => j.state === 'running'
          ? { ...j, state: 'failed', finishedAt: now, error: 'The worker process exited unexpectedly' } : j);
        changed = true;
      }
    }
    if (changed) jobs = store.list();
  }
  return jobs;
}

export function dispatch(config: OfficeConfig): void {
  const store = new JobStore(config.home);
  const desks = new Desks(config.home);
  const jobs = reconcile(store);
  if (!config.startWorkers) return;
  const isCancelled = (id: number) => store.isCancelRequested(id);
  for (const agent of ROSTER) {
    if (desks.occupant(agent.id)) continue; // the worker there will pick the job up
    if (nextRunnable(jobs, agent.id, isCancelled)) spawnWorker(config, agent.id);
  }
}

function spawnWorker(config: OfficeConfig, agentId: string): void {
  const entry = join(config.root, 'bin', 'office.mjs');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry, '__worker', agentId], {
    cwd: config.root,
    detached: true, // outlive the terminal that assigned the job
    stdio: 'ignore',
    windowsHide: true,
    // The worker must see the same office as whoever dispatched it, not whatever its env says.
    env: {
      ...process.env,
      OFFICE_HOME: config.home,
      OFFICE_PROJECTS_DIR: config.projectsDir,
      OFFICE_CLAUDE_BIN: config.claudeBin,
      OFFICE_JOB_TIMEOUT_MIN: String(config.jobTimeoutMs / 60_000),
    },
  });
  child.unref();
}
