import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planningPrompt, handoffRules } from '../src/delegate.ts';
import { designRules, findSearchScript, searchArgs } from '../src/design-search.ts';
import { buildPersona, findAgent, ROSTER } from '../src/roster.ts';

test('only the frontend agent gets the design database', () => {
  assert.deepEqual(ROSTER.filter((a) => a.designSearch).map((a) => a.id), ['frontend']);
  const priya = buildPersona(findAgent('priya')!, 'run.mjs', undefined, designRules('ds.mjs'));
  assert.match(priya, /node "ds\.mjs" .* --design-system --persist/);
  assert.match(priya, /only when the task changes how something looks/, 'told when not to use it');
  assert.match(priya, /MASTER\.md exists, read it/, 'reuses a saved design system instead of searching again');
});

test('Ava sends the look and feel to frontend first, and the rest follow its design system', () => {
  assert.match(planningPrompt('boba shop site'), /frontend first.*MASTER\.md/);
  assert.match(handoffRules().join('\n'), /frontend first.*MASTER\.md/);
});

test('searchArgs keeps output small and persisted files in the task folder', () => {
  const cwd = join('C:', 'work', 'boba');
  assert.deepEqual(searchArgs(['boba cafe playful', '--design-system'], cwd), ['boba cafe playful', '--design-system', '-f', 'markdown']);
  assert.deepEqual(searchArgs(['x', '--design-system', '--json'], cwd), ['x', '--design-system', '--json'], 'explicit format kept');
  assert.deepEqual(
    searchArgs(['x', '--design-system', '--persist', '-p', 'RMH Boba', '--output-dir', 'C:\\elsewhere', '--force'], cwd),
    ['x', '--design-system', '--persist', '-p', 'RMH Boba', '-f', 'markdown', '--output-dir', cwd],
  );
  assert.deepEqual(searchArgs(['form errors', '--domain', 'ux'], cwd), ['form errors', '--domain', 'ux']);
});

test('findSearchScript honours OFFICE_UIUX_DIR', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-uiux-'));
  try {
    const scripts = join(root, '.claude', 'skills', 'ui-ux-pro-max', 'scripts');
    mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, 'search.py'), '');
    assert.equal(findSearchScript({ OFFICE_UIUX_DIR: root }), join(scripts, 'search.py'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
