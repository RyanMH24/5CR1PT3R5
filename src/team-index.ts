import { existsSync } from 'node:fs';
import { getAgent } from './roster.ts';
import type { Job } from './types.ts';

/**
 * A compact "who built what, where" list appended to reviewers' tasks, so a request like
 * "review the script Kai wrote" can be resolved without the user knowing any folder paths.
 * Kept short on purpose: it is part of the prompt, so every line costs tokens.
 */

export const TEAM_INDEX_LIMIT = 25;
const TASK_PREVIEW = 110;

export function buildTeamIndex(
  jobs: readonly Job[],
  current: Job,
  agentsWork: string,
  folderExists: (path: string) => boolean = existsSync,
): string {
  // One line per folder: its latest job describes it best, earlier jobs in it add no new location.
  const latestPerFolder = new Map<string, Job>();
  for (const job of jobs) {
    if (job.id === current.id || job.kind === 'plan' || job.state === 'queued' || job.state === 'cancelled') continue;
    if (job.workspace === current.workspace || !folderExists(job.workspace)) continue;
    latestPerFolder.set(job.workspace, job); // jobs arrive oldest first, so the last write wins
  }
  const entries = [...latestPerFolder.values()].sort((a, b) => b.id - a.id).slice(0, TEAM_INDEX_LIMIT);

  const header = `Team work index (your team's folders live under "${agentsWork}"; newest first):`;
  if (entries.length === 0) return `${header}\n(none yet: no other agent has produced work)`;
  const lines = entries.map((job) => {
    const agent = getAgent(job.agentId);
    const task = job.task.replace(/\s+/g, ' ').trim();
    const preview = task.length > TASK_PREVIEW ? `${task.slice(0, TASK_PREVIEW - 1)}…` : task;
    return `- #${job.id} ${agent.name} (${agent.title}), ${job.state}: "${preview}"\n  folder: ${job.workspace}`;
  });
  return [header, ...lines].join('\n');
}
