import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { isAlive } from './proc.ts';

/**
 * One desk per agent: a lock file holding the pid of the worker currently serving that agent.
 * It guarantees an agent works one job at a time and that only one process claims its queue.
 * Locks left by crashed workers are detected by pid and taken over.
 */
export class Desks {
  private readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, 'desks');
    mkdirSync(this.dir, { recursive: true });
  }

  tryAcquire(agentId: string, pid = process.pid): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.path(agentId), 'wx');
        writeSync(fd, String(pid));
        closeSync(fd);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        const stale = this.holder(agentId);
        if (isAlive(stale)) return false;
        // The holder died without releasing. Re-check right before removing to narrow the window
        // where two processes both clear the same stale lock (only possible after a crash).
        if (this.holder(agentId) === stale) this.remove(agentId);
      }
    }
    return false;
  }

  release(agentId: string, pid = process.pid): void {
    if (this.holder(agentId) === pid) this.remove(agentId);
  }

  /** Pid of the live worker at this desk, if any. */
  occupant(agentId: string): number | undefined {
    const pid = this.holder(agentId);
    return isAlive(pid) ? pid : undefined;
  }

  private holder(agentId: string): number | undefined {
    try {
      const pid = Number(readFileSync(this.path(agentId), 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  private remove(agentId: string): void {
    try { unlinkSync(this.path(agentId)); } catch { /* already gone */ }
  }

  private path(agentId: string): string {
    return join(this.dir, `${agentId}.lock`);
  }
}
