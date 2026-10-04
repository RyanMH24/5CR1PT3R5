import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { emptyProgress } from './events.ts';
import type { Job, NewJob } from './types.ts';

/**
 * File-backed job store. Each job is one JSON file so the CLI and any number of detached worker
 * processes can share state without a daemon. Writes go through temp-file + rename, so readers
 * never see a half-written job.
 *
 * Concurrency contract: a job is written by at most one process at a time. The CLI writes it
 * while it is queued; the worker holding the agent's desk writes it while it runs. Cancellation
 * crosses that line, so it uses a separate marker file instead of a write to the job.
 */
export class JobStore {
  readonly jobsDir: string;
  readonly logsDir: string;

  constructor(home: string) {
    this.jobsDir = join(home, 'jobs');
    this.logsDir = join(home, 'logs');
    mkdirSync(this.jobsDir, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });
  }

  create(input: NewJob): Job {
    const id = this.reserveId();
    const job: Job = {
      id,
      kind: input.kind,
      agentId: input.agentId,
      task: input.task,
      workspace: input.workspace,
      model: input.model,
      budgetUsd: input.budgetUsd,
      state: 'queued',
      createdAt: new Date().toISOString(),
      dependsOn: input.dependsOn ?? [],
      planId: input.planId,
      sessionId: input.sessionId,
      resume: input.resume ?? false,
      progress: emptyProgress(),
    };
    this.write(job);
    return job;
  }

  get(id: number): Job | undefined {
    return this.read(this.jobPath(id));
  }

  /** All jobs, oldest first. */
  list(): Job[] {
    return readdirSync(this.jobsDir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => this.read(join(this.jobsDir, f)))
      .filter((j): j is Job => j !== undefined)
      .sort((a, b) => a.id - b.id);
  }

  update(id: number, change: (job: Job) => Job): Job {
    const current = this.get(id);
    if (!current) throw new Error(`Job #${id} not found`);
    const next = change(current);
    if (next !== current) this.write(next);
    return next;
  }

  requestCancel(id: number): void {
    writeFileSync(this.cancelPath(id), new Date().toISOString());
  }

  isCancelRequested(id: number): boolean {
    return existsSync(this.cancelPath(id));
  }

  logPath(id: number): string {
    return join(this.logsDir, `${id}.ndjson`);
  }

  stderrPath(id: number): string {
    return join(this.logsDir, `${id}.stderr.log`);
  }

  private jobPath(id: number): string {
    return join(this.jobsDir, `${id}.json`);
  }

  private cancelPath(id: number): string {
    return join(this.jobsDir, `${id}.cancel`);
  }

  /** Claim the next sequential id by exclusively creating its file; safe across processes. */
  private reserveId(): number {
    const ids = readdirSync(this.jobsDir).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);
    let id = ids.length ? Math.max(...ids) + 1 : 1;
    for (;;) {
      try {
        const fd = openSync(this.jobPath(id), 'wx');
        writeSync(fd, '{}');
        closeSync(fd);
        return id;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        id += 1;
      }
    }
  }

  private write(job: Job): void {
    const target = this.jobPath(job.id);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(job, null, 2));
    renameWithRetry(temp, target);
  }

  private read(path: string): Job | undefined {
    // A reserved-but-unwritten id holds `{}`; a reader can also briefly lose a race with rename
    // on Windows. Both are transient, so retry before giving up.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const job = JSON.parse(readFileSync(path, 'utf8')) as Partial<Job>;
        if (typeof job.id === 'number') return job as Job;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      }
      sleepSync(15);
    }
    return undefined;
  }
}

/** Windows refuses to replace a file another process has open; that clears within milliseconds. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        try { unlinkSync(from); } catch { /* best effort */ }
        throw err;
      }
      sleepSync(10 + attempt * 5);
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
