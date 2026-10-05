/**
 * Builds the public demo: the office page with a simulated team (web/js/demo.js) in place of the
 * local server, as static files for GitHub Pages or any static host. No agent runs in it.
 *
 *   node scripts/build-demo.ts [--out dist/demo] [--repo https://github.com/<you>/5CR1PT3R5] [--serve]
 *
 * --repo (or DEMO_REPO_URL) adds a "Get the code" link; --serve previews the build on 127.0.0.1.
 */
import { copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Presenter } from '../src/present.ts';
import { ROSTER } from '../src/roster.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join('dist', 'demo') },
    repo: { type: 'string', default: process.env.DEMO_REPO_URL ?? '' },
    serve: { type: 'boolean', default: false },
  },
});

// The link goes into an HTML attribute, so only plain https URLs are accepted.
const repo = values.repo ?? '';
if (repo && !/^https:\/\/[\w.-]+(\/[\w.~-]+)*\/?$/.test(repo)) throw new Error(`--repo must be a plain https URL, got: ${repo}`);

const out = resolve(root, values.out ?? join('dist', 'demo'));
if (!out.startsWith(root + sep)) throw new Error(`--out must be a folder inside ${root}`);
rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'web'), out, { recursive: true });

const indexPath = join(out, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const marker = '<html lang="en">';
if (!html.includes(marker)) throw new Error(`web/index.html no longer starts with ${marker}; update build-demo.ts`);
const description = 'Interactive demo of 5CR1PT3R5: a pixel-art office of 25 Claude Code agents. Simulated; no agent really runs.';

// Link previews (Slack, LinkedIn, X…) need an absolute image URL, so the card is only added when
// --repo is a GitHub repo and the Pages address can be worked out from it.
copyFileSync(join(root, 'brand', 'banner-dark.png'), join(out, 'og-image.png'));
const github = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/?$/.exec(repo);
const site = github ? `https://${github[1].toLowerCase()}.github.io/${github[2]}/` : '';
const card = site ? [
  '<meta property="og:type" content="website">',
  '<meta property="og:title" content="5CR1PT3R5">',
  `<meta property="og:description" content="${description}">`,
  `<meta property="og:url" content="${site}">`,
  `<meta property="og:image" content="${site}og-image.png">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">',
].map((tag) => `\n  ${tag}`).join('') : '';

writeFileSync(indexPath, html
  .replace(marker, `<html lang="en" data-mode="demo"${repo ? ` data-repo="${repo}"` : ''}>`)
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${description}">${card}`));

// The real page gets the team from the server; the demo gets it from the same roster at build time.
const agents = ROSTER.map(({ id, name, title, model, specialty, team, budgetUsd }) => ({ id, name, title, model, specialty, team, budgetUsd }));
writeFileSync(join(out, 'demo-roster.json'), `${JSON.stringify(agents, null, 2)}\n`);
writeFileSync(join(out, '.nojekyll'), ''); // serve files as they are on GitHub Pages

console.log(`Demo built in ${relative(root, out)}${repo ? ` (links to ${repo})` : ''}`);

if (values.serve) {
  const { url } = await new Presenter().present(out);
  console.log(`Previewing at ${url}  (Ctrl+C to stop)`);
}
