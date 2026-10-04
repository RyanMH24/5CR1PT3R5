// @ts-check
/**
 * Decides where every agent should be and what their bubble says, from the job snapshot.
 * Pure function of (agents, jobs, now) so it can be unit-tested and replayed.
 *
 *   running task     -> own workstation, typing        bubble: current step
 *   running plan     -> head of the meeting table       bubble: "Planning…"
 *   queued           -> briefing room                   bubble: "#12 queued"
 *   failed recently  -> "needs you" room                bubble: "#12 failed"
 *   done just now    -> own workstation                 bubble: "#12 done"
 *   otherwise        -> lounge or pantry
 */
import { APPROVAL_SEATS, BRIEFING_SEATS, IDLE_SEATS, PLANNING_SEAT, SPARE_WORKSTATIONS, WORKSTATIONS } from './map.js';

/** @typedef {{ id: string, name: string, title: string, model: string, specialty: string, team: string }} AgentInfo */
/** @typedef {{ content: string, status: 'pending' | 'in_progress' | 'completed', activeForm?: string }} TodoInfo */
/**
 * @typedef {object} JobInfo
 * @property {number} id
 * @property {string} agentId
 * @property {'task' | 'plan'} kind
 * @property {'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'blocked'} state
 * @property {string} task
 * @property {string} model
 * @property {string} workspace
 * @property {number} budgetUsd
 * @property {number[]} dependsOn
 * @property {number} [planId]  Set when the Tech Lead brought this agent in (a plan or a handoff).
 * @property {string} createdAt
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {{ activity: string, todos: TodoInfo[], filesTouched: string[], blocked: string[], toolCalls: number }} progress
 * @property {{ costUsd: number, summary: string, isError: boolean }} [result]
 * @property {string} [error]
 */
/**
 * @typedef {'working' | 'planning' | 'waiting' | 'attention' | 'celebrating' | 'idle'} Mood
 * @typedef {object} Placement
 * @property {string} seat
 * @property {Mood} mood
 * @property {string} [bubble]
 * @property {{ done: number, total: number }} [progress]
 * @property {JobInfo} [job]  The job that explains the placement, if any.
 */

export const ATTENTION_MS = 15 * 60_000;
export const CELEBRATE_MS = 90_000;
const BUBBLE_MAX = 34;

/**
 * @param {AgentInfo[]} agents
 * @param {JobInfo[]} jobs
 * @param {number} now  Epoch ms.
 * @returns {Map<string, Placement>}
 */
export function placeAgents(agents, jobs, now) {
  /** @type {Map<string, Placement>} */
  const placements = new Map();
  const pools = { briefing: [...BRIEFING_SEATS], approval: [...APPROVAL_SEATS] };
  const spares = [...SPARE_WORKSTATIONS];
  const workstation = (/** @type {string} */ id) => WORKSTATIONS[id] ?? spares.shift() ?? IDLE_SEATS[0];

  agents.forEach((agent, index) => {
    const own = jobs.filter((j) => j.agentId === agent.id);
    const running = own.find((j) => j.state === 'running');
    const queued = own.filter((j) => j.state === 'queued');
    const lastFinished = own.filter((j) => j.finishedAt).sort((a, b) => time(b.finishedAt) - time(a.finishedAt))[0];
    const desk = workstation(agent.id);
    const idleSeat = IDLE_SEATS[index % IDLE_SEATS.length];

    if (running?.kind === 'plan') {
      placements.set(agent.id, { seat: PLANNING_SEAT, mood: 'planning', bubble: 'Planning the work…', job: running });
    } else if (running) {
      const todos = running.progress.todos;
      const done = todos.filter((t) => t.status === 'completed').length;
      placements.set(agent.id, {
        seat: desk,
        mood: 'working',
        bubble: clip(running.progress.activity),
        progress: todos.length ? { done, total: todos.length } : undefined,
        job: running,
      });
    } else if (queued.length) {
      const seat = pools.briefing.shift() ?? idleSeat;
      placements.set(agent.id, { seat, mood: 'waiting', bubble: `#${queued[0].id} queued`, job: queued[0] });
    } else if (lastFinished && isProblem(lastFinished) && now - time(lastFinished.finishedAt) < ATTENTION_MS) {
      const seat = pools.approval.shift() ?? idleSeat;
      placements.set(agent.id, { seat, mood: 'attention', bubble: `#${lastFinished.id} ${lastFinished.state}`, job: lastFinished });
    } else if (lastFinished?.state === 'done' && now - time(lastFinished.finishedAt) < CELEBRATE_MS) {
      const team = lastFinished.kind === 'task' ? teamOf(jobs, lastFinished.id).length : 0;
      const bubble = `✓ #${lastFinished.id} done${team ? ` · ${team} brought in` : ''}`;
      placements.set(agent.id, { seat: desk, mood: 'celebrating', bubble, job: lastFinished });
    } else {
      placements.set(agent.id, { seat: idleSeat, mood: 'idle', job: lastFinished });
    }
  });
  return placements;
}

/** Short status sentence for the agent list and screen readers. */
export function describePlacement(/** @type {Placement} */ p) {
  switch (p.mood) {
    case 'working': return `Working on #${p.job?.id}: ${p.job?.progress.activity ?? ''}`;
    case 'planning': return `Planning #${p.job?.id} in the meeting room`;
    case 'waiting': return `Waiting in the briefing room (#${p.job?.id} queued)`;
    case 'attention': return `Needs you: #${p.job?.id} ${p.job?.state}`;
    case 'celebrating': return `Just finished #${p.job?.id}`;
    default: return 'Idle';
  }
}

/** Jobs the Tech Lead handed out from one of her jobs. @param {JobInfo[]} jobs @param {number} leadJobId */
export const teamOf = (jobs, leadJobId) => jobs.filter((j) => j.planId === leadJobId);

/** @param {JobInfo} job */
const isProblem = (job) => job.state === 'failed' || job.state === 'blocked';
/** @param {string | undefined} iso */
const time = (iso) => (iso ? Date.parse(iso) : 0);
/** @param {string} text */
const clip = (text) => (text.length > BUBBLE_MAX ? `${text.slice(0, BUBBLE_MAX - 1)}…` : text);
