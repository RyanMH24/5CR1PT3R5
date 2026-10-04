import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { findSite, Presenter, resolvePresented } from '../src/present.ts';

const roots: string[] = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** Make a task folder from a map of relative path -> contents. */
function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'office-present-'));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('findSite picks the built or served page first, then any HTML page', () => {
  const boba = folder({ 'server.mjs': '', 'site/index.html': '<h1>boba</h1>', 'README.md': '' });
  assert.deepEqual(findSite(boba), { kind: 'web', root: join(boba, 'site'), entry: 'index.html' });

  const built = folder({ 'index.html': '<script src="/src/main.jsx">', 'dist/index.html': 'built', 'package.json': '{}' });
  assert.deepEqual(findSite(built), { kind: 'web', root: join(built, 'dist'), entry: 'index.html' });

  const plain = folder({ 'index.html': 'hi' });
  assert.deepEqual(findSite(plain), { kind: 'web', root: plain, entry: 'index.html' });

  const calculator = folder({ 'calculator.py': '', 'ui/calc.html': 'calc' });
  assert.deepEqual(findSite(calculator), { kind: 'web', root: join(calculator, 'ui'), entry: 'calc.html' });
});

test('findSite explains when there is nothing to show, and never builds', () => {
  const script = folder({ 'backup.ps1': '', 'README.md': '' });
  const nothing = findSite(script);
  assert.match(nothing.kind === 'none' ? nothing.reason : '', /no web page/);

  const vite = folder({
    'index.html': '<script type="module" src="/src/main.jsx"></script>',
    'package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } }),
  });
  const site = findSite(vite);
  assert.equal(site.kind, 'none');
  assert.match(site.kind === 'none' ? site.reason : '', /npm run build/);

  assert.match((findSite(join(script, 'gone')) as { reason: string }).reason, /no longer exists/);
});

test('presented folders never serve hidden files or escape the folder', () => {
  const root = join('C:', 'work', 'site');
  assert.equal(resolvePresented(root, '/css/app.css'), join(root, 'css', 'app.css'));
  for (const hidden of ['/.env', '/.git/config', '/a/.secret/x']) assert.equal(resolvePresented(root, hidden), undefined, hidden);
  for (const escape of ['/../server.mjs', '/%2e%2e/x', '/..%5c..%5cpackage.json']) {
    const file = resolvePresented(root, escape);
    assert.ok(file === undefined || file.startsWith(root), `${escape} escaped: ${file}`);
  }
});

test('Present serves the page on its own port and reuses it', async () => {
  const site = folder({ 'site/index.html': '<h1>boba</h1>', 'site/css/app.css': 'body{}', 'site/.env': 'SECRET=1' });
  const presenter = new Presenter();
  try {
    const first = await presenter.present(site);
    assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal((await presenter.present(site)).url, first.url, 'one server per folder');

    const page = await fetch(first.url);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), '<h1>boba</h1>');
    assert.equal((await fetch(`${first.url}css/app.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal((await fetch(`${first.url}.env`)).status, 404);
    assert.equal((await fetch(first.url, { method: 'POST' })).status, 405);
    await assert.rejects(presenter.present(folder({ 'tool.py': '' })), /no web page/);
  } finally {
    await presenter.close();
  }
});
