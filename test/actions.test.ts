import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { ActionError, assign, cancel, delegate, reply } from '../src/actions.ts';
import { loadConfig, type OfficeConfig } from '../src/config.ts';
import { JobStore } from '../src/store.ts';

// Workers are switched off: these tests cover what gets queued, not running real agents.
const roots: string[] = [];
let config: OfficeConfig;
let store: JobStore;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'office-actions-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects', 'agent-office'), { recursive: true });
  config = {
    ...loadConfig({ OFFICE_HOME: join(root, 'home'), OFFICE_PROJECTS_DIR: join(root, 'Projects'), OFFICE_START_WORKERS: '0' }),
    root: join(root, 'Projects', 'agent-office'),
  };
  store = new JobStore(config.home);
});
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

test('assign takes plain English and an agent by name, alias or id', () => {
  const job = assign(config, store, { agent: 'C#', task: '  Make me a tray app that reminds me to drink water  ' });
  assert.equal(job.agentId, 'csharp');
  assert.equal(job.task, 'Make me a tray app that reminds me to drink water');
  assert.equal(job.model, 'sonnet');
  assert.match(job.workspace, /tray-app-reminds-drink-water$/);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

test('attached images land in the task folder and the agent is told about them', () => {
  const job = assign(config, store, {
    agent: 'priya', task: 'Landing page for my bakery',
    attachments: [{ name: 'Bakery Logo.PNG', data: PNG }, { name: 'croissant.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') }],
  });
  assert.ok(existsSync(join(job.workspace, 'attachments', 'bakery-logo.png')));
  assert.ok(existsSync(join(job.workspace, 'attachments', 'croissant.svg')));
  assert.match(job.task, /^Landing page for my bakery\n\nAttached images \(in attachments\/\): bakery-logo\.png, croissant\.svg\./);

  const plan = delegate(config, store, { task: 'Bakery site', attachments: [{ name: 'logo.png', data: PNG }] });
  assert.ok(existsSync(join(plan.workspace, 'attachments', 'logo.png')), 'shared with the whole team');
});

test('a bad attachment is refused before anything is queued or written', () => {
  const before = store.list().length;
  const fake = Buffer.from('MZ this is really an exe').toString('base64');
  assert.throws(() => assign(config, store, { agent: 'priya', task: 'Use my logo', attachments: [{ name: 'logo.png', data: fake }] }), /isn't an image/);
  assert.equal(store.list().length, before);
  assert.ok(!existsSync(join(config.projectsDir, 'use-logo')), 'no folder left behind');
});

test('assign validates input with readable errors', () => {
  assert.throws(() => assign(config, store, { agent: 'cobol', task: 'x' }), ActionError);
  assert.throws(() => assign(config, store, { agent: 'js', task: '   ' }), /Describe what needs to be done/);
  assert.throws(() => assign(config, store, { agent: 'js', task: 'x', model: 'gpt-4' }), /Unknown model/);
  assert.throws(() => assign(config, store, { agent: 'js', task: 'x', budget: '500' }), /budget/);
});

test('delegate creates a plan job for the Tech Lead', () => {
  const job = delegate(config, store, { task: 'A recipe site with search', project: 'recipes' });
  assert.equal(job.kind, 'plan');
  assert.equal(job.agentId, 'tech-lead');
  assert.equal(job.workspace, join(config.projectsDir, 'recipes'));
});

test('reply continues a finished job in the same folder and session', () => {
  const first = assign(config, store, { agent: 'python', task: 'rename photos' });
  assert.throws(() => reply(config, store, { job: first.id, message: 'more' }), /still|never started/);
  store.update(first.id, (j) => ({ ...j, state: 'done', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }));
  const next = reply(config, store, { job: `#${first.id}`, message: 'Add a --dry-run flag' });
  assert.equal(next.resume, true);
  assert.equal(next.sessionId, first.sessionId);
  assert.equal(next.workspace, first.workspace);
});

test('cancel stops queued jobs and ignores finished ones', () => {
  const job = assign(config, store, { agent: 'go', task: 'dedupe files', after: undefined });
  store.update(job.id, (j) => ({ ...j, state: 'queued' }));
  const first = cancel(store, job.id);
  assert.equal(first.cancelled, true);
  assert.equal(store.get(job.id)?.state, 'cancelled');
  assert.equal(cancel(store, job.id).cancelled, false);
});
