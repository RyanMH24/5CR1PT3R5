import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildArgs } from '../src/claude.ts';
import { emptyProgress } from '../src/events.ts';
import { buildPersona, findAgent, ROSTER } from '../src/roster.ts';
import { buildTeamIndex, TEAM_INDEX_LIMIT } from '../src/team-index.ts';
import type { Job } from '../src/types.ts';

const WORK = join('C:', 'Projects', 'Agents Work');

function job(id: number, agentId: string, folder: string, extra: Partial<Job> = {}): Job {
  return {
    id, agentId, kind: 'task', task: `task ${id}`, workspace: join(WORK, folder), model: 'haiku', budgetUsd: 1,
    state: 'done', createdAt: '', dependsOn: [], sessionId: 's', resume: false, progress: emptyProgress(), ...extra,
  };
}

test('reviewers are the lead, security and QA', () => {
  assert.deepEqual(ROSTER.filter((a) => a.seesAllWork).map((a) => a.id).sort(), ['qa', 'security', 'tech-lead']);
});

test('the index lists other agents\' folders, newest first, one line per folder', () => {
  const review = job(9, 'tech-lead', 'review-jamf', { state: 'running', task: 'Review the jamf script Kai wrote' });
  const index = buildTeamIndex([
    job(1, 'javascript', 'date-countdown'),
    job(2, 'zsh', 'jamf-policy', { task: 'Write me a jamf policy script' }),
    job(3, 'zsh', 'jamf-policy', { task: 'Add a --dry-run flag', resume: true }), // same folder, later job
    job(4, 'python', 'gone-folder'),
    job(5, 'go', 'still-queued', { state: 'queued' }),
    job(6, 'tech-lead', 'plan-folder', { kind: 'plan' }),
    review,
  ], review, WORK, (p) => !p.endsWith('gone-folder'));

  assert.match(index, /Agents Work/);
  const lines = index.split('\n').filter((l) => l.startsWith('- #'));
  assert.deepEqual(lines.map((l) => l.slice(0, 5)), ['- #3 ', '- #1 ']);
  assert.match(index, /#3 Kai \(Zsh Specialist\), done: "Add a --dry-run flag"\n {2}folder: .*jamf-policy/);
  assert.doesNotMatch(index, /gone-folder|still-queued|plan-folder|review-jamf/);
});

test('the index is capped and says so when empty', () => {
  const me = job(999, 'qa', 'mine', { state: 'running' });
  const many = Array.from({ length: 40 }, (_, i) => job(i + 1, 'python', `f${i}`));
  const lines = buildTeamIndex(many, me, WORK, () => true).split('\n').filter((l) => l.startsWith('- #'));
  assert.equal(lines.length, TEAM_INDEX_LIMIT);
  assert.match(buildTeamIndex([], me, WORK, () => true), /none yet/);
});

test('reviewers get folder access and instructions; specialists do not', () => {
  const args = buildArgs({ model: 'opus', budgetUsd: 1, sessionId: 's', resume: false, name: 'n', tools: ['Read'], allow: [], deny: [], addDirs: [WORK] });
  assert.deepEqual(args.slice(args.indexOf('--add-dir'), args.indexOf('--add-dir') + 2), ['--add-dir', WORK]);
  assert.ok(!buildArgs({ model: 'haiku', budgetUsd: 1, sessionId: 's', resume: false, name: 'n', tools: [], allow: [], deny: [] }).includes('--add-dir'));
  assert.match(buildPersona(findAgent('ava')!, 'run.mjs', WORK), /every agent's folder/);
  assert.doesNotMatch(buildPersona(findAgent('js')!, 'run.mjs', WORK), /every agent's folder/);
});
