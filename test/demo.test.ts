import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROSTER } from '../src/roster.ts';
import { DemoOffice, planTeam, PRESENT_IN_DEMO, slugify, type DemoAgent } from '../web/js/demo.js';
import { placeAgents } from '../web/js/director.js';

const AGENTS: DemoAgent[] = ROSTER.map(({ id, name, title, model, specialty, team, budgetUsd }) => ({ id, name, title, model, specialty, team, budgetUsd }));
const T0 = Date.parse('2026-10-03T12:00:00Z');

/** Run the office clock forward in one-second ticks, like the page does. */
function run(office: DemoOffice, from: number, seconds: number): number {
  let now = from;
  for (let i = 0; i < seconds; i++) office.tick(now += 1000);
  return now;
}

test('the demo opens on a busy office: reports to read, one problem, work in progress', () => {
  const office = new DemoOffice(AGENTS, { now: T0, seed: 1 });
  const { jobs, spentTodayUsd } = office.snapshot(T0);
  assert.ok(jobs.some((j) => j.state === 'done' && j.result?.summary), 'a finished job with a report');
  assert.ok(jobs.some((j) => j.state === 'failed' && j.error), 'a failed job for the Needs You room');
  assert.ok(jobs.some((j) => j.state === 'running' && j.kind === 'plan'), 'Ava planning in the meeting room');
  assert.ok(spentTodayUsd > 0);
  const moods = new Set([...placeAgents(AGENTS, jobs, T0).values()].map((p) => p.mood));
  for (const mood of ['working', 'planning', 'attention', 'celebrating', 'idle']) assert.ok(moods.has(mood as never), `someone is ${mood}`);
});

test('a delegated project is planned, fanned out in order, and finished by the team', () => {
  const office = new DemoOffice(AGENTS, { now: T0, seed: 2 });
  const { job: plan } = office.handle('/api/delegate', { task: 'A recipe site with a SQLite database and a REST API' }, T0);
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.agentId, 'tech-lead');

  let now = T0;
  let team = office.snapshot(now).jobs.filter((j) => j.planId === plan.id);
  for (let i = 0; i < 60 * 30 && !(team.length && team.every((j) => j.state === 'done')); i++) {
    now = run(office, now, 1);
    team = office.snapshot(now).jobs.filter((j) => j.planId === plan.id);
    const byAgent = new Map(team.map((j) => [j.agentId, j]));
    const qa = byAgent.get('qa');
    if (qa?.state === 'running') {
      for (const builder of ['database', 'backend', 'frontend']) assert.equal(byAgent.get(builder)?.state, 'done', `QA waits for ${builder}`);
    }
    if (byAgent.get('backend')?.state === 'running') assert.equal(byAgent.get('database')?.state, 'done', 'the API waits for the schema');
  }
  assert.deepEqual(team.map((j) => j.agentId), ['database', 'backend', 'frontend', 'qa', 'writer']);
  assert.ok(team.every((j) => j.state === 'done' && j.workspace === plan.workspace && j.result?.summary));
  const finishedPlan = office.snapshot(now).jobs.find((j) => j.id === plan.id);
  assert.match(finishedPlan?.result?.summary ?? '', /Split it into 5 jobs: Rosa, Marcus, Priya, Iris, Theo/);
});

test('an agent works one job at a time; follow-ups continue in the same folder', () => {
  const office = new DemoOffice(AGENTS, { now: T0, seed: 3 });
  const first = office.handle('/api/assign', { agent: 'c', task: 'Count words in a file' }, T0).job;
  const second = office.handle('/api/assign', { agent: 'c', task: 'Count lines too', model: 'sonnet' }, T0).job;
  assert.equal(second.model, 'sonnet');
  let snap = office.snapshot(T0);
  assert.equal(snap.jobs.find((j) => j.id === first.id)?.state, 'running');
  assert.equal(snap.jobs.find((j) => j.id === second.id)?.state, 'queued');

  let now = run(office, T0, 120);
  snap = office.snapshot(now);
  assert.equal(snap.jobs.find((j) => j.id === first.id)?.state, 'done');
  const reply = office.handle('/api/reply', { job: first.id, message: 'Add a --json option' }, now).job;
  assert.equal(reply.workspace, first.workspace);
  now = run(office, now, 120);
  const done = office.snapshot(now).jobs.find((j) => j.id === reply.id);
  assert.equal(done?.state, 'done');
  assert.match(done?.result?.summary ?? '', /--json/);
});

test('stopping a job blocks the jobs waiting on it', () => {
  const office = new DemoOffice(AGENTS, { now: T0, seed: 4 });
  const plan = office.handle('/api/delegate', { task: 'A landing page with a small API' }, T0).job;
  let now = run(office, T0, 20);
  const team = office.snapshot(now).jobs.filter((j) => j.planId === plan.id);
  const builder = team.find((j) => j.agentId === 'backend');
  assert.ok(builder);
  const { cancelled } = office.handle('/api/cancel', { job: builder.id }, now);
  assert.equal(cancelled, true);
  now = run(office, now, 2);
  const qa = office.snapshot(now).jobs.find((j) => j.planId === plan.id && j.agentId === 'qa');
  assert.equal(qa?.state, 'blocked');
  assert.match(qa?.error ?? '', /cancelled/);
});

test('the demo answers like the server: friendly errors, no Present', () => {
  const office = new DemoOffice(AGENTS, { now: T0, seed: 5 });
  assert.throws(() => office.handle('/api/present', { job: 1 }, T0), { message: PRESENT_IN_DEMO });
  assert.throws(() => office.handle('/api/assign', { agent: 'nobody', task: 'x' }, T0), /Pick someone/);
  assert.throws(() => office.handle('/api/assign', { agent: 'go', task: '   ' }, T0), /Describe what needs to be done/);
  assert.throws(() => office.handle('/api/reply', { job: 999, message: 'hi' }, T0), /no job #999/);
  const snap = office.snapshot(T0);
  snap.jobs[0].state = 'cancelled';
  assert.notEqual(office.snapshot(T0).jobs[0].state, 'cancelled', 'snapshots are copies');
});

test('left alone for an afternoon, the autopilot keeps the floor busy without piling up', () => {
  const office = new DemoOffice(AGENTS, { now: T0, seed: 6 });
  let now = T0;
  let peak = 0;
  for (let minute = 0; minute < 240; minute++) {
    now = run(office, now, 60);
    peak = Math.max(peak, office.active().length);
  }
  const { jobs } = office.snapshot(now);
  assert.ok(jobs.length > 100 || office.sims.length > 100, `plenty of jobs ran (${office.sims.length})`);
  assert.ok(peak <= 12, `active jobs stay bounded (peak ${peak})`);
  assert.ok(new Set(office.sims.map((s) => s.job.agentId)).size >= 20, 'most of the team gets work');
  assert.equal(new Set(office.sims.map((s) => s.job.id)).size, office.sims.length, 'ids are unique');
});

test('Ava picks the team from the words in the request', () => {
  const ids = (task: string) => planTeam(task).map((p) => p.agentId);
  assert.deepEqual(ids('A todo web app with a Node API, SQLite storage, tests and a README'), ['database', 'backend', 'frontend', 'qa', 'writer']);
  assert.deepEqual(ids('A PowerShell script and a C# tray app, deployed with Docker'), ['powershell', 'csharp', 'devops', 'qa', 'writer']);
  assert.deepEqual(ids('Something nobody has a keyword for'), ['fullstack', 'qa', 'writer']);
  assert.deepEqual(ids('I want to go home'), ['fullstack', 'qa', 'writer'], 'plain English "go" is not Go');
  assert.equal(slugify('Rename all photos in a folder by the date they were taken'), 'rename-photos-folder');
  assert.equal(slugify('!!!'), 'task');
});
