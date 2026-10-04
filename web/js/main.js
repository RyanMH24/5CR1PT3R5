// @ts-check
/**
 * Boots the office page: subscribes to live snapshots, keeps each agent's walking state, and
 * drives the render loop. Placement decisions live in director.js; drawing in renderer.js.
 */
import { useBackend } from './api.js';
import { Composer } from './composer.js';
import { placeAgents } from './director.js';
import { COLS, FURNITURE, getSeat, HANGOUTS, ROOMS, ROWS, TILE } from './map.js';
import { DEMO, REPO_URL } from './mode.js';
import { Panel } from './panel.js';
import { buildGrid, findPath } from './pathfinding.js';
import { OfficeRenderer } from './renderer.js';
import { lookFor } from './sprites.js';
import { Wanderer } from './wander.js';

/** @typedef {import('./map.js').Tile} Tile */
/** @typedef {import('./map.js').Facing} Facing */
/** @typedef {import('./panel.js').Snapshot} Snapshot */
/** @typedef {import('./director.js').Placement} Placement */
/**
 * @typedef {object} Actor
 * @property {string} id
 * @property {string} name
 * @property {import('./sprites.js').Look} look
 * @property {Tile} tile  Last tile fully reached.
 * @property {number} x
 * @property {number} y
 * @property {Tile[]} path
 * @property {string} seatId
 * @property {import('./map.js').Hangout} [spot]  Where an idle agent is wandering to, if anywhere.
 * @property {Facing} facing
 * @property {number} frame
 * @property {Placement} placement
 */

const WALK_TILES_PER_SECOND = 3.5;
const REPLACE_EVERY_MS = 5000; // re-run placement so "just finished" bubbles expire on time
const WANDER_TICK_MS = 1000;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('office'));
const floor = $('floor');
const overlay = $('floor-overlay');
const conn = $('conn');
const announcer = $('announcer');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const grid = buildGrid(ROOMS, FURNITURE, COLS, ROWS);
const renderer = new OfficeRenderer(canvas);
const wanderer = new Wanderer(HANGOUTS);
/** @type {Map<string, Actor>} */
const actors = new Map();
/** @type {Snapshot | null} */
let snapshot = null;
/** @type {Map<string, Placement>} */
let placements = new Map();
let selected = decodeURIComponent(location.hash.slice(1)) || null;

const panel = new Panel({ roster: $('roster'), detail: $('detail'), stats: $('stats'), onSelect: select });
const composer = new Composer(/** @type {HTMLFormElement} */ ($('composer')), {
  onAssigned: (job) => select(job.agentId),
});

// ── state ───────────────────────────────────────────────────────────────────

/** @param {Tile} tile */
const feet = (tile) => ({ x: (tile.x + 0.5) * TILE, y: (tile.y + 1) * TILE - 3 });

/** @param {Snapshot} next */
function applySnapshot(next) {
  const previous = snapshot;
  snapshot = next;
  placements = placeAgents(next.agents, next.jobs, Date.now());
  for (const agent of next.agents) {
    const placement = /** @type {Placement} */ (placements.get(agent.id));
    const seat = getSeat(placement.seat);
    const actor = actors.get(agent.id);
    if (!actor) {
      // First sight: put everyone straight in their seat rather than marching in at once.
      actors.set(agent.id, {
        id: agent.id, name: agent.name, look: lookFor(agent.id), tile: { x: seat.x, y: seat.y }, ...feet(seat),
        path: [], seatId: seat.id, facing: seat.facing, frame: Math.random() * 4, placement,
      });
      continue;
    }
    actor.placement = placement;
  }
  retarget();
  if (selected && !next.agents.some((a) => a.id === selected)) selected = null;
  if (previous) announce(previous, next);
  composer.setAgents(next.agents);
  if (!previous) composer.setTarget(selected);
  panel.update(next, placements, selected);
  overlay.hidden = true;
  floor.removeAttribute('aria-busy');
}

/**
 * Send every agent where they belong: their seat from the placement, or a hangout spot while
 * they're idle and the wanderer has them out on a little trip.
 */
function retarget() {
  const idle = [...actors.values()].filter((a) => a.placement.mood === 'idle').map((a) => a.id);
  // Reduced motion: no wandering, since agents would jump between spots instead of walking.
  const trips = reducedMotion.matches ? new Map()
    : wanderer.update(idle, Date.now(), (id) => (actors.get(id)?.path.length ?? 0) > 0);
  for (const actor of actors.values()) {
    const spot = trips.get(actor.id);
    const seat = getSeat(actor.placement.seat);
    const target = spot ?? seat;
    if (actor.seatId === seat.id && actor.spot?.id === spot?.id) continue;
    actor.seatId = seat.id;
    actor.spot = spot;
    actor.path = reducedMotion.matches ? [] : findPath(grid, actor.tile, target);
    if (actor.path.length === 0) Object.assign(actor, { tile: { x: target.x, y: target.y }, ...feet(target), facing: target.facing });
  }
}

/** @param {string | null} id */
function select(id) {
  selected = id;
  composer.setTarget(id);
  history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : location.pathname);
  if (snapshot) panel.update(snapshot, placements, selected);
}

/** Tell screen-reader users about jobs starting and finishing. @param {Snapshot} before @param {Snapshot} after */
function announce(before, after) {
  const was = new Map(before.jobs.map((j) => [j.id, j.state]));
  const names = new Map(after.agents.map((a) => [a.id, a.name]));
  const messages = [];
  for (const job of after.jobs) {
    if (was.get(job.id) === job.state) continue;
    const who = names.get(job.agentId) ?? job.agentId;
    if (job.state === 'running') messages.push(`${who} started job ${job.id}.`);
    else if (job.state === 'done') messages.push(`${who} finished job ${job.id}.`);
    else if (job.state === 'failed' || job.state === 'blocked') messages.push(`Job ${job.id} for ${who} ${job.state}.`);
    else if (job.state === 'queued' && !was.has(job.id)) messages.push(`New job ${job.id} for ${who}.`);
  }
  if (messages.length) announcer.textContent = messages.join(' ');
}

// ── live data ───────────────────────────────────────────────────────────────

/** The demo build: a simulated office in this tab instead of the server (see demo.js). */
async function runDemo() {
  const banner = $('demo-banner');
  banner.append('Demo: simulated agents, nothing really runs. ');
  if (REPO_URL) banner.append(Object.assign(document.createElement('a'), { href: REPO_URL, textContent: 'Get the code', rel: 'noopener' }));
  banner.hidden = false;
  conn.textContent = 'Demo';
  conn.dataset.state = 'live';

  const { DemoOffice } = await import('./demo.js');
  let agents;
  try {
    const res = await fetch('demo-roster.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    agents = await res.json();
  } catch (err) {
    overlay.textContent = 'The demo couldn’t load its team. Reload to try again.';
    console.error(err);
    return;
  }
  const office = new DemoOffice(agents, { now: Date.now() });
  const push = () => {
    const now = Date.now();
    office.tick(now);
    applySnapshot(office.snapshot(now));
  };
  useBackend((path, body) => {
    const reply = office.handle(path, body, Date.now());
    queueMicrotask(push); // show the new job straight away, like the server's immediate broadcast
    return reply;
  });
  push();
  setInterval(push, 1000);
}

function connect() {
  let connected = false;
  const source = new EventSource('api/events');
  source.onopen = () => {
    connected = true;
    conn.textContent = 'Live';
    conn.dataset.state = 'live';
  };
  source.onmessage = (event) => {
    try {
      applySnapshot(JSON.parse(event.data));
    } catch (err) {
      console.error('Bad snapshot from the office server', err);
    }
  };
  source.onerror = () => {
    conn.textContent = 'Reconnecting…';
    conn.dataset.state = 'down';
    if (!connected && !snapshot) {
      overlay.hidden = false;
      overlay.textContent = 'Can’t reach the office. Is `office ui` still running in your terminal?';
    }
  };
}

// ── animation ───────────────────────────────────────────────────────────────

/** @param {number} dt seconds */
function step(dt) {
  const speed = WALK_TILES_PER_SECOND * TILE * dt;
  for (const actor of actors.values()) {
    const next = actor.path[0];
    if (!next) {
      actor.facing = (actor.spot ?? getSeat(actor.seatId)).facing;
      actor.frame += dt * (actor.placement.mood === 'working' ? 5 : 1);
      continue;
    }
    const target = feet(next);
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const dist = Math.hypot(dx, dy);
    actor.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    actor.frame += dt * 8;
    if (dist <= speed) {
      Object.assign(actor, target, { tile: next });
      actor.path.shift();
    } else {
      actor.x += (dx / dist) * speed;
      actor.y += (dy / dist) * speed;
    }
  }
}

function scene(/** @type {number} */ time) {
  /** @type {Tile[]} */
  const litScreens = [];
  const agents = [...actors.values()].map((a) => {
    const walking = a.path.length > 0;
    const mood = a.placement.mood;
    const typing = !walking && mood === 'working';
    const screen = getSeat(a.seatId).screen;
    if (!walking && !a.spot && screen && (mood === 'working' || mood === 'celebrating')) litScreens.push(screen);
    return {
      id: a.id, name: a.name, look: a.look, x: a.x, y: a.y, mood,
      // At a hangout spot they stand; at their seat they sit.
      pose: { facing: a.facing, walking, seated: !walking && !a.spot, typing, frame: reducedMotion.matches ? 0 : a.frame },
      bubble: walking ? undefined : a.spot?.bubble ?? a.placement.bubble,
      progress: walking ? undefined : a.placement.progress,
      selected: a.id === selected,
    };
  });
  return { agents, litScreens, time, animate: !reducedMotion.matches };
}

let last = performance.now();
/** @param {number} now */
function frame(now) {
  step(Math.min(0.1, (now - last) / 1000));
  last = now;
  renderer.render(scene(now));
  requestAnimationFrame(frame);
}

// ── input ───────────────────────────────────────────────────────────────────

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const hit = renderer.hitTest(scene(performance.now()), event.clientX - rect.left, event.clientY - rect.top, rect.width);
  select(hit ? (hit.id === selected ? null : hit.id) : null);
});
canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const hit = renderer.hitTest(scene(performance.now()), event.clientX - rect.left, event.clientY - rect.top, rect.width);
  canvas.style.cursor = hit ? 'pointer' : 'default';
});
document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLElement && event.target.matches('input, textarea, select');
  if (event.key === 'Escape' && selected && !typing) select(null);
});

// ── boot ────────────────────────────────────────────────────────────────────

canvas.style.setProperty('--map-ratio', String(COLS / ROWS)); // the floor plan decides the shape
new ResizeObserver(() => renderer.resize(canvas.clientWidth)).observe(canvas);
renderer.resize(canvas.clientWidth || 800);
void document.fonts.ready.then(() => renderer.invalidate());
setInterval(() => panel.tick(), 1000);
setInterval(() => { if (snapshot) applySnapshot(snapshot); }, REPLACE_EVERY_MS);
setInterval(() => { if (snapshot) retarget(); }, WANDER_TICK_MS);
if (DEMO) void runDemo();
else connect();
requestAnimationFrame(frame);
// Installable app + opens offline. Needs a secure origin: 127.0.0.1, localhost or HTTPS.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('No offline support:', err));
