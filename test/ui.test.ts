import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseOrigins } from '../src/config.ts';
import { buildSnapshot, isTrustedWrite, resolveStatic } from '../src/ui-server.ts';
import { ROSTER } from '../src/roster.ts';
import type { Job } from '../src/types.ts';
import { ATTENTION_MS, CELEBRATE_MS, placeAgents, type JobInfo } from '../web/js/director.js';
import { COLS, ENTRANCE, FURNITURE, getSeat, HANGOUTS, IDLE_SEATS, ROOMS, ROWS, SEATS, WORKSTATIONS } from '../web/js/map.js';
import { buildGrid, findPath, isWalkable } from '../web/js/pathfinding.js';
import { WANDER, Wanderer } from '../web/js/wander.js';

const grid = buildGrid(ROOMS, FURNITURE, COLS, ROWS);
const NOW = Date.parse('2026-10-02T12:00:00Z');
const agents = ROSTER.map(({ id, name, title, model, specialty, team }) => ({ id, name, title, model, specialty, team }));

function job(id: number, agentId: string, state: JobInfo['state'], extra: Partial<JobInfo> = {}): JobInfo {
  return {
    id, agentId, state, kind: 'task', task: 't', model: 'haiku', workspace: '/w', budgetUsd: 1, dependsOn: [],
    createdAt: new Date(NOW - 60_000).toISOString(),
    progress: { activity: 'Editing app.ts', todos: [], filesTouched: [], blocked: [], toolCalls: 0 },
    ...extra,
  };
}

test('every seat can be reached from the entrance', () => {
  assert.ok(isWalkable(grid, ENTRANCE.x, ENTRANCE.y));
  for (const seat of SEATS) {
    const path = findPath(grid, ENTRANCE, seat);
    assert.ok(path.length > 0, `seat ${seat.id} at ${seat.x},${seat.y} is unreachable`);
    // Every intermediate step must be walkable; only the seat itself may sit on furniture.
    for (const tile of path.slice(0, -1)) assert.ok(isWalkable(grid, tile.x, tile.y), `${seat.id} path crosses ${tile.x},${tile.y}`);
  }
});

test('seats are unique and every roster agent has a workstation', () => {
  const keys = SEATS.map((s) => `${s.x},${s.y}`);
  assert.equal(new Set(keys).size, keys.length, 'two seats share a tile');
  for (const agent of ROSTER) assert.ok(WORKSTATIONS[agent.id], `${agent.id} has no workstation`);
  assert.ok(IDLE_SEATS.length >= ROSTER.length, 'not enough idle seats for the team');
});

test('every hangout is open floor, off the seats, and reachable from every idle seat', () => {
  const seats = new Set(SEATS.map((s) => `${s.x},${s.y}`));
  const spots = HANGOUTS.map((h) => `${h.x},${h.y}`);
  assert.equal(new Set(spots).size, spots.length, 'two hangouts share a tile');
  assert.equal(new Set(HANGOUTS.map((h) => h.id)).size, HANGOUTS.length, 'duplicate hangout id');
  for (const h of HANGOUTS) {
    assert.ok(isWalkable(grid, h.x, h.y), `${h.id} at ${h.x},${h.y} is not open floor`);
    assert.ok(!seats.has(`${h.x},${h.y}`), `${h.id} sits on a seat`);
    for (const id of IDLE_SEATS) {
      const seat = getSeat(id);
      assert.ok(findPath(grid, seat, h).length > 0, `${h.id} unreachable from ${id}`);
      assert.ok(findPath(grid, h, seat).length > 0, `${id} unreachable from ${h.id}`);
    }
  }
});

test('idle agents take staggered, capped trips and come back', () => {
  let r = 0;
  const wanderer = new Wanderer(HANGOUTS, () => (r = (r + 0.37) % 1)); // spread-out but repeatable
  const idle = ROSTER.map((a) => a.id);
  const walking = new Set<string>();
  const isWalking = (id: string) => walking.has(id);

  assert.equal(wanderer.update(idle, NOW, isWalking).size, 0, 'nobody leaves the moment the page opens');
  const later = NOW + WANDER.firstTripMs[1];
  const out = wanderer.update(idle, later, isWalking);
  assert.equal(out.size, WANDER.maxOut, 'capped, not a fire drill');
  assert.equal(new Set([...out.values()].map((s) => s.id)).size, out.size, 'one agent per spot');

  const [traveller] = out.keys();
  walking.add(traveller);
  assert.ok(wanderer.update(idle, later + 60_000, isWalking).has(traveller), 'stays out while still walking there');
  walking.delete(traveller);
  wanderer.update(idle, later + 61_000, isWalking); // arrives
  assert.ok(!wanderer.update(idle, later + 61_000 + WANDER.lingerMs[1], isWalking).has(traveller), 'heads back after lingering');
});

test('an agent who gets work drops their trip at once', () => {
  const wanderer = new Wanderer(HANGOUTS, () => 0.5);
  wanderer.update(['qa'], NOW, () => false);
  assert.ok(wanderer.update(['qa'], NOW + WANDER.firstTripMs[1], () => false).has('qa'));
  assert.equal(wanderer.update([], NOW + WANDER.firstTripMs[1] + 1, () => false).size, 0);
  assert.equal(wanderer.update(['qa'], NOW + WANDER.firstTripMs[1] + 2, () => false).size, 0, 'waits again before the next trip');
});

test('findPath returns nothing for unreachable targets', () => {
  assert.deepEqual(findPath(grid, ENTRANCE, ENTRANCE), []);
  const sealed = buildGrid([{ id: 'box', label: '', x: 0, y: 0, w: 5, h: 5, doors: [] }], [], 10, 10);
  assert.deepEqual(findPath(sealed, { x: 7, y: 7 }, { x: 2, y: 2 }), []);
});

test('placement follows job state', () => {
  const placements = placeAgents(agents, [
    job(1, 'powershell', 'running', { progress: { activity: 'Writing backup.ps1', todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }], filesTouched: [], blocked: [], toolCalls: 3 } }),
    job(2, 'tech-lead', 'running', { kind: 'plan' }),
    job(3, 'zsh', 'queued'),
    job(4, 'qa', 'failed', { finishedAt: new Date(NOW - 60_000).toISOString() }),
    job(5, 'writer', 'done', { finishedAt: new Date(NOW - 10_000).toISOString() }),
  ], NOW);

  assert.deepEqual(placements.get('powershell'), {
    seat: WORKSTATIONS.powershell, mood: 'working', bubble: 'Writing backup.ps1', progress: { done: 1, total: 2 }, job: placements.get('powershell')?.job,
  });
  assert.equal(placements.get('tech-lead')?.seat, 'meet-head');
  assert.match(placements.get('zsh')?.seat ?? '', /^brief-/);
  assert.match(placements.get('qa')?.seat ?? '', /^approval-/);
  assert.equal(placements.get('writer')?.mood, 'celebrating');
  assert.equal(placements.get('backend')?.mood, 'idle');
});

test('the lead\'s bubble says how many teammates she brought in', () => {
  const finished = new Date(NOW - 10_000).toISOString();
  const placements = placeAgents(agents, [
    job(11, 'tech-lead', 'done', { finishedAt: finished }),
    job(12, 'javascript', 'running', { planId: 11 }),
    job(13, 'qa', 'queued', { planId: 11, dependsOn: [12] }),
  ], NOW);
  assert.equal(placements.get('tech-lead')?.bubble, '✓ #11 done · 2 brought in');
});

test('attention and celebration expire', () => {
  const later = placeAgents(agents, [
    job(4, 'qa', 'failed', { finishedAt: new Date(NOW - ATTENTION_MS - 1).toISOString() }),
    job(5, 'writer', 'done', { finishedAt: new Date(NOW - CELEBRATE_MS - 1).toISOString() }),
  ], NOW);
  assert.equal(later.get('qa')?.mood, 'idle');
  assert.equal(later.get('writer')?.mood, 'idle');
});

test('no two agents share a seat', () => {
  const jobs = ROSTER.map((a, i) => job(i + 1, a.id, i % 2 ? 'queued' : 'failed', i % 2 ? {} : { finishedAt: new Date(NOW).toISOString() }));
  const seats = [...placeAgents(agents, jobs, NOW).values()].map((p) => p.seat);
  assert.equal(new Set(seats).size, seats.length);
});

test('static files cannot escape the web root', () => {
  const root = resolve('web');
  assert.equal(resolveStatic(root, '/'), join(root, 'index.html'));
  assert.equal(resolveStatic(root, '/js/main.js?v=1'), join(root, 'js', 'main.js'));
  for (const bad of ['/../package.json', '/%2e%2e/src/cli.ts', '/..%5c..%5cpackage.json', '/%E0%A4%A']) {
    const resolved = resolveStatic(root, bad);
    assert.ok(resolved === undefined || resolved.startsWith(root), `${bad} escaped: ${resolved}`);
  }
});

test('only the office page on this machine may send write requests', () => {
  const ok = { host: '127.0.0.1:4777', origin: 'http://127.0.0.1:4777', 'content-type': 'application/json; charset=utf-8' };
  assert.equal(isTrustedWrite({ headers: ok }, 4777), true);
  assert.equal(isTrustedWrite({ headers: { ...ok, host: 'localhost:4777', origin: 'http://localhost:4777' } }, 4777), true);
  assert.equal(isTrustedWrite({ headers: { ...ok, origin: 'https://evil.example' } }, 4777), false, 'other site');
  assert.equal(isTrustedWrite({ headers: { ...ok, origin: undefined } }, 4777), false, 'no origin');
  assert.equal(isTrustedWrite({ headers: { ...ok, host: 'evil.example:4777' } }, 4777), false, 'DNS rebinding');
  assert.equal(isTrustedWrite({ headers: { ...ok, 'content-type': 'text/plain' } }, 4777), false, 'simple form post');
  assert.equal(isTrustedWrite({ headers: ok }, 4778), false, 'wrong port');
});

test('a proxy origin you allowed (e.g. tailscale serve) may send writes; nothing else new may', () => {
  const tailnet = 'https://office-pc.tail1234.ts.net';
  const viaProxy = { host: 'office-pc.tail1234.ts.net', origin: tailnet, 'content-type': 'application/json' };
  assert.equal(isTrustedWrite({ headers: viaProxy }, 4777), false, 'not allowed by default');
  assert.equal(isTrustedWrite({ headers: viaProxy }, 4777, [tailnet]), true);
  // Some proxies pass the upstream Host through; the page's Origin is still the proxy's.
  assert.equal(isTrustedWrite({ headers: { ...viaProxy, host: '127.0.0.1:4777' } }, 4777, [tailnet]), true);
  assert.equal(isTrustedWrite({ headers: { ...viaProxy, origin: 'https://evil.example' } }, 4777, [tailnet]), false, 'other site');
  assert.equal(isTrustedWrite({ headers: { ...viaProxy, host: 'evil.example' } }, 4777, [tailnet]), false, 'DNS rebinding');

  assert.deepEqual(parseOrigins(` ${tailnet}/ , http://plain.example, not a url,https://b.example:8443/path`),
    [tailnet, 'https://b.example:8443'], 'HTTPS origins only, normalised');
  assert.deepEqual(parseOrigins(undefined), []);
});

test('snapshots hide internal fields and total today’s spend', () => {
  const base = () => ({ kind: 'task' as const, task: 't', workspace: '/w', model: 'haiku', budgetUsd: 1, createdAt: '', dependsOn: [], resume: false, progress: { activity: '', todos: [], filesTouched: [], toolCalls: 0, turns: 0, blocked: [] } });
  const now = new Date('2026-10-02T12:00:00Z');
  const jobs: Job[] = [
    { ...base(), id: 1, agentId: 'zsh', state: 'done', sessionId: 'secret', workerPid: 42, finishedAt: now.toISOString(), result: { summary: '', costUsd: 0.25, durationMs: 1, turns: 1, isError: false } },
    { ...base(), id: 2, agentId: 'qa', state: 'running', sessionId: 'secret2', workerPid: 43 },
  ];
  const snap = buildSnapshot(jobs, now);
  assert.equal(snap.spentTodayUsd, 0.25);
  assert.equal(snap.agents.length, ROSTER.length);
  assert.ok(!JSON.stringify(snap).includes('secret'));
  assert.ok(snap.jobs.every((j) => j.workerPid === undefined));
});
