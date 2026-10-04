import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyEvent, describeTool, emptyProgress, parseEventLine, parseResult, todoCounts } from '../src/events.ts';

const WS = join(process.cwd(), 'ws');

const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name, input }] },
});

test('parseEventLine ignores blank, partial and non-object lines', () => {
  assert.equal(parseEventLine(''), undefined);
  assert.equal(parseEventLine('{"type":"assi'), undefined);
  assert.equal(parseEventLine('[1,2]'), undefined);
  assert.deepEqual(parseEventLine(' {"type":"system"} '), { type: 'system' });
});

test('TodoWrite updates the plan and the current activity', () => {
  const p = applyEvent(emptyProgress(), toolUse('TodoWrite', {
    todos: [
      { content: 'Write script', status: 'completed', activeForm: 'Writing script' },
      { content: 'Test script', status: 'in_progress', activeForm: 'Testing script' },
      { content: 'Docs', status: 'pending' },
    ],
  }), WS);
  assert.equal(p.todos.length, 3);
  assert.equal(p.activity, 'Testing script');
  assert.deepEqual({ ...todoCounts(p.todos), current: undefined }, { done: 1, total: 3, current: undefined });
});

test('file writes are recorded once, relative to the workspace', () => {
  let p = emptyProgress();
  p = applyEvent(p, toolUse('Write', { file_path: join(WS, 'src', 'app.ts') }), WS);
  p = applyEvent(p, toolUse('Edit', { file_path: join(WS, 'src', 'app.ts') }), WS);
  p = applyEvent(p, toolUse('Read', { file_path: join(WS, 'README.md') }), WS);
  assert.deepEqual(p.filesTouched, ['src/app.ts']);
  assert.equal(p.toolCalls, 3);
  assert.equal(p.activity, 'Reading README.md');
});

test('permission denials are surfaced with the blocked command', () => {
  const p = applyEvent(emptyProgress(), {
    type: 'system',
    subtype: 'permission_denied',
    tool_name: 'PowerShell',
    message: 'Permission ... denied. What required approval: & .\\hello.ps1',
  }, WS);
  assert.deepEqual(p.blocked, ['PowerShell: & .\\hello.ps1']);
});

test('parseResult maps success and error results', () => {
  assert.deepEqual(parseResult({ type: 'result', subtype: 'success', is_error: false, result: ' Done. ', total_cost_usd: 0.05, duration_ms: 900, num_turns: 4 }),
    { summary: 'Done.', costUsd: 0.05, durationMs: 900, turns: 4, isError: false });
  assert.equal(parseResult({ type: 'result', subtype: 'error_max_budget_usd', is_error: false })?.isError, true);
  assert.equal(parseResult({ type: 'assistant' }), undefined);
});

test('describeTool drops a leading cd into the task folder', () => {
  assert.equal(describeTool('Bash', { command: 'cd "C:/Users/x/My Project" && pytest -q' }, WS), 'Running: pytest -q');
  assert.equal(describeTool('PowerShell', { command: "Set-Location 'C:\\w'; npm test" }, WS), 'Running: npm test');
});

test('describeTool turns script-runner calls and long paths into readable steps', () => {
  const runner = 'C:\\Users\\me\\Projects\\agent-office\\bin\\run-script.mjs';
  assert.equal(describeTool('PowerShell', { command: `& node "${runner}" run "C:\\Users\\me\\Projects\\x\\countdown.js"` }, WS), 'Running countdown.js');
  assert.equal(describeTool('Bash', { command: `node "${runner}" check backup.ps1` }, WS), 'Checking backup.ps1');
  assert.equal(describeTool('Bash', { command: 'python "C:\\Users\\me\\Projects\\x\\rename.py" --dry-run' }, WS), 'Running: python rename.py --dry-run');
});

test('describeTool keeps shell commands on one short line', () => {
  const text = describeTool('Bash', { command: `npm test\n${'x'.repeat(300)}` }, WS);
  assert.ok(text.startsWith('Running: npm test x'));
  assert.ok(text.length <= 'Running: '.length + 120);
});
