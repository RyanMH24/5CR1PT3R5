import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { Desks } from '../src/desk.ts';
import { nextRunnable, readiness, reconcile } from '../src/scheduler.ts';
import { JobStore } from '../src/store.ts';
import type { Job, NewJob } from '../src/types.ts';

const roots: string[] = [];
let store: JobStore;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'office-test-'));
  roots.push(home);
  store = new JobStore(home);
});
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const newJob = (agentId: string, extra: Partial<NewJob> = {}): Job => store.create({
  kind: 'task', agentId, task: `task for ${agentId}`, workspace: home, model: 'haiku', budgetUsd: 1, sessionId: 's', ...extra,
});
const setState = (id: number, state: Job['state']) => store.update(id, (j) => ({ ...j, state }));

test('ids are sequential and jobs round-trip', () => {
  const a = newJob('zsh');
  const b = newJob('powershell');
  assert.deepEqual([a.id, b.id], [1, 2]);
  assert.equal(store.get(2)?.agentId, 'powershell');
  assert.deepEqual(store.list().map((j) => j.id), [1, 2]);
  assert.equal(store.get(99), undefined);
});

test('readiness follows dependencies', () => {
  const dep = newJob('backend');
  const job = newJob('qa', { dependsOn: [dep.id] });
  const map = () => new Map(store.list().map((j) => [j.id, j]));
  assert.equal(readiness(job, map()), 'waiting');
  setState(dep.id, 'done');
  assert.equal(readiness(job, map()), 'ready');
  setState(dep.id, 'failed');
  assert.equal(readiness(job, map()), 'blocked');
});

test('nextRunnable is FIFO per agent and skips cancelled or waiting jobs', () => {
  const first = newJob('zsh');
  const second = newJob('zsh');
  newJob('powershell');
  const isCancelled = (id: number) => id === first.id;
  assert.equal(nextRunnable(store.list(), 'zsh', isCancelled)?.id, second.id);
  assert.equal(nextRunnable(store.list(), 'zsh', () => false)?.id, first.id);

  const dep = newJob('backend');
  newJob('qa', { dependsOn: [dep.id] });
  assert.equal(nextRunnable(store.list(), 'qa', () => false), undefined);
});

test('reconcile cancels, blocks transitively, and fails orphaned running jobs', () => {
  const cancelled = newJob('zsh');
  store.requestCancel(cancelled.id);
  const failed = newJob('backend');
  setState(failed.id, 'failed');
  const child = newJob('qa', { dependsOn: [failed.id] });
  const grandchild = newJob('writer', { dependsOn: [child.id] });
  const orphan = newJob('python');
  store.update(orphan.id, (j) => ({ ...j, state: 'running', workerPid: 2 ** 22 + 12345 })); // no such pid

  const states = new Map(reconcile(store).map((j) => [j.id, j.state]));
  assert.equal(states.get(cancelled.id), 'cancelled');
  assert.equal(states.get(child.id), 'blocked');
  assert.equal(states.get(grandchild.id), 'blocked');
  assert.equal(states.get(orphan.id), 'failed');
});

test('a desk holds one worker and frees itself when the holder is gone', () => {
  const desks = new Desks(home);
  assert.equal(desks.tryAcquire('zsh'), true);
  assert.equal(desks.tryAcquire('zsh'), false); // our own live pid holds it
  assert.equal(desks.occupant('zsh'), process.pid);
  desks.release('zsh');
  assert.equal(desks.occupant('zsh'), undefined);

  assert.equal(desks.tryAcquire('qa', 2 ** 22 + 54321), true); // dead pid
  assert.equal(desks.tryAcquire('qa'), true, 'stale lock is taken over');
});
