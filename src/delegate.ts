import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROSTER } from './roster.ts';
import type { Job } from './types.ts';

/**
 * `office delegate` hands a large request to the Tech Lead, who returns a plan of subtasks routed
 * to the cheapest capable agents. The planning call loads no tools and returns only structured
 * JSON, so the expensive model spends a few thousand tokens and the cheaper models do the work.
 *
 * A job assigned to the Tech Lead directly works the other way round: she does her own part
 * first, then brings in the teammates the rest needs by writing a handoff file in the same plan
 * format. Her teammates start in the same folder once she finishes.
 */

export interface PlannedSubtask {
  agent: string;
  task: string;
  /** Indexes of earlier subtasks that must finish first. */
  dependsOn: number[];
}

export interface Plan {
  summary: string;
  subtasks: PlannedSubtask[];
}

export const MAX_SUBTASKS = 8;

/**
 * Only the frontend agent has the design database, so one design pass sets the look and everyone
 * else reads the saved result instead of searching (or guessing) again.
 */
const DESIGN_FIRST = 'When the project has a user interface, give its look and feel to frontend first: it saves a design system to design-system/<project>/MASTER.md. Make the other UI subtasks depend on it and tell them to follow that file.';

export function planSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'subtasks'],
    properties: {
      summary: { type: 'string', description: 'One sentence describing the approach.' },
      subtasks: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SUBTASKS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['agent', 'task', 'dependsOn'],
          properties: {
            agent: { type: 'string', enum: ROSTER.map((a) => a.id) },
            task: { type: 'string' },
            dependsOn: { type: 'array', items: { type: 'integer', minimum: 0 } },
          },
        },
      },
    },
  };
}

export function planningPrompt(request: string): string {
  const team = ROSTER.map((a) => `- ${a.id} (${a.title}, ${a.model}): ${a.specialty}`).join('\n');
  return [
    'You are the Tech Lead. Split the request below into the smallest set of subtasks for your team.',
    '',
    'Team (id, role, model):',
    team,
    '',
    'Rules:',
    `- 1 to ${MAX_SUBTASKS} subtasks. Do not split work that one agent can do well in one go.`,
    '- Route each subtask to the cheapest capable agent: haiku agents for scripts and docs, sonnet for',
    '  engineering, opus agents (tech-lead, security) only when the subtask truly needs them.',
    `- ${DESIGN_FIRST}`,
    '- Every agent works in the same shared folder but sees only its own task text, so each task must',
    '  be self-contained: name the files to create or read and the interfaces to honour.',
    '- dependsOn lists indexes (0-based) of earlier subtasks that must finish first. Run independent',
    '  work in parallel by leaving dependsOn empty.',
    '- Do not write any code yourself. Respond only with the plan.',
    '',
    'Request:',
    request,
  ].join('\n');
}

/** The file the Tech Lead writes in her task folder to bring teammates in. */
export const HANDOFF_FILE = 'HANDOFF.json';

/**
 * Only a Tech Lead job the person gave her (or a follow-up to one) may bring people in. Jobs that
 * came from a plan or a handoff may not, so a review she asked for can't keep spawning work.
 */
export function canHandOff(job: Pick<Job, 'agentId' | 'kind' | 'planId'>): boolean {
  return job.agentId === 'tech-lead' && job.kind === 'task' && job.planId === undefined;
}

/** Persona rules for a Tech Lead job that may bring teammates in. */
export function handoffRules(): string[] {
  const team = ROSTER.filter((a) => a.id !== 'tech-lead').map((a) => `${a.id} (${a.specialty})`).join('; ');
  return [
    '- You lead this project. Do your own part (architecture, scaffolding, shared interfaces, anything risky), then bring in the teammates the rest needs instead of building it all yourself. A small job, or one meant only for you such as a review, needs no one else.',
    `- To bring people in, your last step is to write ${HANDOFF_FILE} in your folder: {"summary": "<one sentence>", "subtasks": [{"agent": "<id>", "task": "<task>", "dependsOn": [<indexes of earlier subtasks>]}]}. At most ${MAX_SUBTASKS} subtasks. They start in this folder after you finish; independent ones run in parallel.`,
    '- Each teammate sees only their own task text, so name the files to read or create and the interfaces to honour. Pick the cheapest capable agent. Add a last tech-lead subtask only if their work needs your review.',
    `- ${DESIGN_FIRST}`,
    `- Team: ${team}.`,
    '- In your summary, say what you did yourself and who you brought in for what.',
  ];
}

/**
 * Read and remove the Tech Lead's handoff file. Returns undefined when she brought no one in,
 * and throws with a readable reason when the file is not a valid plan.
 */
export function takeHandoff(workspace: string): Plan | undefined {
  const path = join(workspace, HANDOFF_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  // Removed either way: a follow-up must not hand the same work out twice.
  rmSync(path, { force: true });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${HANDOFF_FILE} is not valid JSON`);
  }
  return parsePlan(raw, '');
}

/** Extract and validate a plan from a result event's structured output or text. */
export function parsePlan(structured: unknown, text: string): Plan {
  const raw = structured ?? extractJson(text);
  if (!raw || typeof raw !== 'object') throw new Error('The Tech Lead did not return a plan');
  const { summary, subtasks } = raw as Partial<Plan>;
  if (!Array.isArray(subtasks) || subtasks.length === 0) throw new Error('The plan has no subtasks');
  if (subtasks.length > MAX_SUBTASKS) throw new Error(`The plan has more than ${MAX_SUBTASKS} subtasks`);

  const ids = new Set(ROSTER.map((a) => a.id));
  const clean = subtasks.map((s, index): PlannedSubtask => {
    if (!s || typeof s.task !== 'string' || !s.task.trim()) throw new Error(`Subtask ${index} has no task`);
    if (!ids.has(s.agent)) throw new Error(`Subtask ${index} names an unknown agent: ${String(s.agent)}`);
    const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
    for (const d of deps) {
      // Only earlier subtasks: this rules out cycles by construction.
      if (!Number.isInteger(d) || d < 0 || d >= index) throw new Error(`Subtask ${index} has an invalid dependency: ${d}`);
    }
    return { agent: s.agent, task: s.task.trim(), dependsOn: [...new Set(deps)] };
  });
  return { summary: typeof summary === 'string' ? summary : '', subtasks: clean };
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
