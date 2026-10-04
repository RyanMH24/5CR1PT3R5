import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const runner = join(import.meta.dirname, '..', 'bin', 'run-script.mjs');
const root = mkdtempSync(join(tmpdir(), 'office-run-'));
const task = join(root, 'task');
mkdirSync(task);
after(() => rmSync(root, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [runner, ...args], { cwd: task, encoding: 'utf8' });

test('runs and checks scripts inside the task folder', () => {
  writeFileSync(join(task, 'ok.mjs'), 'console.log("hi from " + process.argv[2])');
  const res = run('run', 'ok.mjs', 'agent');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /hi from agent/);
  writeFileSync(join(task, 'bad.mjs'), 'const = ;');
  assert.notEqual(run('check', 'bad.mjs').status, 0);
});

test('refuses scripts outside the task folder', () => {
  writeFileSync(join(root, 'outside.mjs'), 'console.log("escaped")');
  const res = run('run', '../outside.mjs');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /only scripts inside the task folder/);
});

test('rejects unknown modes and file types', () => {
  writeFileSync(join(task, 'notes.txt'), '');
  assert.equal(run('exec', 'ok.mjs').status, 2);
  assert.equal(run('run', 'notes.txt').status, 3);
});

test('checks PowerShell syntax with the real parser', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  writeFileSync(join(task, 'good.ps1'), 'param([string]$Name = "x")\nWrite-Output "hi $Name"\n');
  writeFileSync(join(task, 'broken.ps1'), 'function f {\n  Write-Output "unclosed"\n');
  const good = run('check', 'good.ps1');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /Syntax OK/);
  assert.notEqual(run('check', 'broken.ps1').status, 0);
  assert.match(run('run', 'good.ps1', '-Name', 'office').stdout, /hi office/);
});
