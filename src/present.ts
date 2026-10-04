import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, relative, sep } from 'node:path';
import { resolveStatic } from './ui-server.ts';

/**
 * "Present" opens what an agent built in the browser, straight from its task folder, without
 * opening an editor or starting the project's own server. It only serves files that are already
 * there: nothing is installed or built.
 *
 * Each folder gets its own small static server on a random 127.0.0.1 port. A separate origin
 * matters: an agent-written page can't post to the office API (the Origin check rejects it), and
 * root-relative links like /css/app.css resolve inside the project instead of the office.
 */

/** Folders that usually hold the page to show, best first. "." is the task folder itself. */
const SITE_DIRS = ['dist', 'build', 'out', 'site', 'public', 'www', 'docs', '.'];
const SKIP_DIRS = new Set(['node_modules', '.git']);
const MAX_SERVERS = 8;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm',
};

export type Site =
  | { kind: 'web'; root: string; entry: string }
  | { kind: 'none'; reason: string };

/** Work out which page in a task folder to show, without changing anything. */
export function findSite(folder: string): Site {
  if (!existsSync(folder)) return { kind: 'none', reason: 'This job\'s folder no longer exists.' };

  for (const dir of SITE_DIRS) {
    const root = join(folder, dir);
    if (isFile(join(root, 'index.html'))) {
      // An unbuilt bundler project has an index.html that points at source files the browser
      // can't run (e.g. /src/main.jsx). Say so rather than show a blank page.
      if (dir === '.' && needsBuild(folder)) break;
      return { kind: 'web', root, entry: 'index.html' };
    }
  }
  if (needsBuild(folder)) {
    return { kind: 'none', reason: 'This project needs a build first. Run `npm run build` in its folder, then Present again.' };
  }

  // No index.html: show the first HTML page in the folder or one level down.
  for (const dir of ['.', ...subfolders(folder)]) {
    const root = join(folder, dir);
    const page = htmlFiles(root)[0];
    if (page) return { kind: 'web', root, entry: page };
  }
  return { kind: 'none', reason: 'There is no web page to present in this folder. Scripts and tools need to be run, and their report says how.' };
}

/** A package.json with a build script and a bundler, and no built page yet. */
function needsBuild(folder: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    if (!pkg.scripts?.build) return false;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    return deps.some((d) => /^(vite|react-scripts|next|parcel|webpack|@angular\/cli|@sveltejs\/kit|astro|nuxt)$/.test(d));
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function subfolders(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function htmlFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => /\.html?$/i.test(f) && isFile(join(dir, f))).sort();
  } catch {
    return [];
  }
}

/** Map a request path to a file under `root`. Hidden files (.env, .git) are never served. */
export function resolvePresented(root: string, urlPath: string): string | undefined {
  const file = resolveStatic(root, urlPath);
  if (!file) return undefined;
  const rel = relative(root, file);
  if (rel.split(sep).some((part) => part.startsWith('.'))) return undefined;
  return file;
}

interface Running {
  server: Server;
  url: string;
}

export interface PresentResult {
  /** Address of the page to open. */
  url: string;
  /** Folder being served, for the status line. */
  root: string;
}

/** Keeps one static server per presented folder for as long as the office page is open. */
export class Presenter {
  private running = new Map<string, Running>();

  /** Serve the folder's page and return its address, or throw with a reason the user can read. */
  async present(folder: string): Promise<PresentResult> {
    const site = findSite(folder);
    if (site.kind === 'none') throw new Error(site.reason);
    let running = this.running.get(site.root);
    if (!running) {
      running = await serve(site.root);
      this.running.set(site.root, running);
      await this.trim();
    }
    const entry = site.entry.split('/').map(encodeURIComponent).join('/');
    return { url: `${running.url}${entry === 'index.html' ? '' : entry}`, root: site.root };
  }

  /** Close the oldest servers beyond the cap, so a long session doesn't pile up ports. */
  private async trim(): Promise<void> {
    while (this.running.size > MAX_SERVERS) {
      const [root, oldest] = this.running.entries().next().value as [string, Running];
      this.running.delete(root);
      await new Promise<void>((done) => oldest.server.close(() => done()));
    }
  }

  async close(): Promise<void> {
    const all = [...this.running.values()];
    this.running.clear();
    await Promise.all(all.map(({ server }) => new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    })));
  }
}

function serve(root: string): Promise<Running> {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let file = resolvePresented(root, req.url ?? '/');
    if (file && !isFile(file) && isFile(join(file, 'index.html'))) file = join(file, 'index.html');
    // Single-page apps route in the browser: an unknown path without an extension gets the app.
    if (file && !isFile(file) && !extname(file) && isFile(join(root, 'index.html'))) file = join(root, 'index.html');
    if (!file || !isFile(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store', // a follow-up's changes show on the next reload
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Could not read that file');
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}
