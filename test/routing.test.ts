import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildArgs } from '../src/claude.ts';
import { resolveWorkspace, slugify } from '../src/actions.ts';
import { loadConfig } from '../src/config.ts';
import { canHandOff, HANDOFF_FILE, handoffRules, parsePlan, takeHandoff } from '../src/delegate.ts';
import { buildPersona, findAgent, ROSTER } from '../src/roster.ts';

test('the office has at least 10 agents with unique ids and aliases', () => {
  assert.ok(ROSTER.length >= 10);
  const names = ROSTER.flatMap((a) => [a.id, ...a.aliases]);
  assert.equal(new Set(names).size, names.length);
});

test('findAgent resolves ids, aliases, names and prefixes', () => {
  assert.equal(findAgent('pwsh')?.id, 'powershell');
  assert.equal(findAgent('Kai')?.id, 'zsh');
  assert.equal(findAgent('sec')?.id, 'security');
  assert.equal(findAgent('data')?.id, 'database');
  assert.equal(findAgent('nobody'), undefined);
});

test('scripting and web languages and docs run on the cheapest model; compiled languages on sonnet', () => {
  for (const id of ['powershell', 'zsh', 'bash', 'python', 'javascript', 'typescript', 'php', 'ruby', 'writer']) {
    assert.equal(findAgent(id)?.model, 'haiku', id);
  }
  for (const id of ['java', 'csharp', 'go', 'c', 'cpp', 'rust', 'swift', 'kotlin']) assert.equal(findAgent(id)?.model, 'sonnet', id);
});

test('every language has exactly one specialist, reachable by common names', () => {
  const languages = ROSTER.filter((a) => a.team === 'Languages');
  assert.equal(languages.length, 16);
  const lookups: Array<[string, string]> = [
    ['js', 'javascript'], ['ts', 'typescript'], ['c#', 'csharp'], ['dotnet', 'csharp'], ['c++', 'cpp'],
    ['c', 'c'], ['golang', 'go'], ['rs', 'rust'], ['rb', 'ruby'], ['kt', 'kotlin'], ['sh', 'bash'],
    ['sql', 'database'], ['html', 'frontend'], ['java', 'java'],
  ];
  for (const [query, id] of lookups) assert.equal(findAgent(query)?.id, id, query);
  for (const agent of languages) assert.ok(agent.allow.length > 0 && agent.budgetUsd > 0, agent.id);
});

test('buildArgs sandboxes the run and starts or resumes the session', () => {
  const base = { model: 'haiku', budgetUsd: 0.5, sessionId: 'abc', name: 'n', tools: ['Read'], allow: ['Write'], deny: ['Bash(git push)'] };
  const fresh = buildArgs({ ...base, resume: false });
  for (const flag of ['--restricted', '--disable-slash-commands', '--strict-mcp-config']) assert.ok(fresh.includes(flag), flag);
  assert.deepEqual(fresh.slice(fresh.indexOf('--permission-prompts'), fresh.indexOf('--permission-prompts') + 2), ['--permission-prompts', 'none']);
  assert.deepEqual(fresh.slice(-2), ['--session-id', 'abc']);
  assert.equal(fresh[fresh.indexOf('--max-budget-usd') + 1], '0.50');
  assert.deepEqual(buildArgs({ ...base, resume: true }).slice(-2), ['--resume', 'abc']);
  const plan = buildArgs({ ...base, tools: [], allow: [], deny: [], resume: false, jsonSchema: { type: 'object' } });
  assert.equal(plan[plan.indexOf('--tools') + 1], '');
  assert.ok(!plan.includes('--allowedTools'));
});

test('parsePlan validates agents and dependency order', () => {
  const plan = parsePlan({ summary: 's', subtasks: [
    { agent: 'backend', task: 'API', dependsOn: [] },
    { agent: 'qa', task: 'tests', dependsOn: [0, 0] },
  ] }, '');
  assert.deepEqual(plan.subtasks[1].dependsOn, [0]);
  assert.throws(() => parsePlan({ subtasks: [{ agent: 'qa', task: 't', dependsOn: [0] }] }, ''), /invalid dependency/);
  assert.throws(() => parsePlan({ subtasks: [{ agent: 'ceo', task: 't', dependsOn: [] }] }, ''), /unknown agent/);
  assert.equal(parsePlan(undefined, 'Plan: {"summary":"x","subtasks":[{"agent":"zsh","task":"t","dependsOn":[]}]}').subtasks[0].agent, 'zsh');
});

test('only a Tech Lead job the person gave her may bring the team in', () => {
  assert.equal(canHandOff({ agentId: 'tech-lead', kind: 'task' }), true);
  assert.equal(canHandOff({ agentId: 'tech-lead', kind: 'task', planId: 4 }), false, 'a review she handed herself');
  assert.equal(canHandOff({ agentId: 'tech-lead', kind: 'plan' }), false);
  assert.equal(canHandOff({ agentId: 'backend', kind: 'task' }), false);
  const ava = buildPersona(findAgent('ava')!, 'run.mjs', undefined, handoffRules());
  assert.match(ava, new RegExp(HANDOFF_FILE));
  assert.match(ava, /javascript \(/, 'she is told who is on the team');
  assert.doesNotMatch(buildPersona(findAgent('ava')!, 'run.mjs'), new RegExp(HANDOFF_FILE));
});

test('takeHandoff reads the lead\'s file once and rejects bad ones with a reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-handoff-'));
  try {
    const file = join(dir, HANDOFF_FILE);
    assert.equal(takeHandoff(dir), undefined, 'no file: she brought no one in');

    writeFileSync(file, JSON.stringify({ summary: 'Jade builds the UI, Iris tests it', subtasks: [
      { agent: 'javascript', task: 'Build the cart in src/cart.js', dependsOn: [] },
      { agent: 'qa', task: 'Test src/cart.js', dependsOn: [0] },
    ] }));
    const plan = takeHandoff(dir);
    assert.deepEqual(plan?.subtasks.map((s) => s.agent), ['javascript', 'qa']);
    assert.ok(!existsSync(file), 'removed so a follow-up does not hand it out again');

    writeFileSync(file, '{ not json');
    assert.throws(() => takeHandoff(dir), /not valid JSON/);
    assert.ok(!existsSync(file));
    writeFileSync(file, JSON.stringify({ subtasks: [{ agent: 'ceo', task: 't', dependsOn: [] }] }));
    assert.throws(() => takeHandoff(dir), /unknown agent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('slugify makes short, readable folder names', () => {
  assert.equal(slugify('Write me a PowerShell script that backs up Documents to D:\\Backup'), 'powershell-backs-up-documents-d');
  assert.equal(slugify('!!!'), '');
});

test('every prompt gets a fresh folder in Agents Work by default', () => {
  const config = loadConfig({});
  assert.equal(config.projectsDir, join(config.root, '..', 'Agents Work'));
});

test('resolveWorkspace picks fresh folders and refuses unsafe ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-ws-'));
  try {
    const work = join(root, 'Projects', 'Agents Work');
    mkdirSync(join(root, 'Projects', '5CR1PT3R5'), { recursive: true });
    mkdirSync(work);
    const config = { ...loadConfig({ OFFICE_PROJECTS_DIR: work, OFFICE_HOME: join(root, 'home') }), root: join(root, 'Projects', '5CR1PT3R5') };

    assert.equal(resolveWorkspace(config, undefined, 'backup tool'), join(work, 'backup-tool'));
    mkdirSync(join(work, 'backup-tool'));
    assert.equal(resolveWorkspace(config, undefined, 'backup tool'), join(work, 'backup-tool-2'), 'a new prompt never reuses a folder');
    assert.equal(resolveWorkspace(config, 'backup tool', 'anything'), join(work, 'backup-tool'), 'explicit name reuses');
    assert.throws(() => resolveWorkspace(config, '5cr1pt3r5', 't'), /office's own folder/);
    assert.throws(() => resolveWorkspace(config, work + '/', 't'), /can't work directly/);
    writeFileSync(join(root, 'file.txt'), '');
    assert.throws(() => resolveWorkspace(config, join(root, 'file.txt'), 't'), /Folder not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
