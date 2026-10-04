import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { ActionError, assign, cancel, delegate, reply, requireJob } from './actions.ts';
import { MAX_TOTAL_BYTES } from './attachments.ts';
import type { OfficeConfig } from './config.ts';
import { Presenter } from './present.ts';
import { ROSTER } from './roster.ts';
import { reconcile } from './scheduler.ts';
import { JobStore } from './store.ts';
import type { Job } from './types.ts';

/**
 * Local web server for the pixel-art office (`office ui`). Serves the static page in web/,
 * pushes job snapshots over Server-Sent Events, and accepts plain-English tasks from the page.
 *
 * Single-user and local by design: it binds to 127.0.0.1, and write requests must carry a
 * matching Host and Origin plus a JSON body. That blocks other websites (which cannot send a
 * cross-origin JSON POST without a CORS preflight we never answer) and DNS-rebinding attacks.
 */

const POLL_MS = 1000;
const RECONCILE_EVERY = 5; // polls; reconcile scans and may write, so not every tick
const HEARTBEAT_MS = 15_000;
const MAX_FINISHED = 60;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const MAX_BODY_BYTES = 64 * 1024;
/** Routes that carry attached images: base64 adds a third, plus room for the JSON around it. */
const UPLOAD_ROUTES = new Set(['/api/assign', '/api/delegate', '/api/reply']);
const MAX_UPLOAD_BODY_BYTES = Math.ceil(MAX_TOTAL_BYTES * 4 / 3) + 1024 * 1024;

export interface Snapshot {
  generatedAt: string;
  spentTodayUsd: number;
  agents: Array<{ id: string; name: string; title: string; model: string; specialty: string; team: string }>;
  jobs: Job[];
}

export function buildSnapshot(jobs: readonly Job[], now = new Date()): Snapshot {
  const active = jobs.filter((j) => j.state === 'queued' || j.state === 'running');
  const finished = jobs.filter((j) => j.finishedAt).slice(-MAX_FINISHED);
  const today = now.toDateString();
  return {
    generatedAt: now.toISOString(),
    spentTodayUsd: jobs
      .filter((j) => j.finishedAt && new Date(j.finishedAt).toDateString() === today)
      .reduce((sum, j) => sum + (j.result?.costUsd ?? 0), 0),
    agents: ROSTER.map(({ id, name, title, model, specialty, team }) => ({ id, name, title, model, specialty, team })),
    // Worker pids and session ids are internal; the page has no use for them.
    jobs: [...finished, ...active].map(({ workerPid: _pid, sessionId: _sid, ...job }) => job as Job),
  };
}

/** Map a URL path to a file inside `webRoot`, or undefined if it would escape it. */
export function resolveStatic(webRoot: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return undefined;
  }
  const relative = normalize(decoded === '/' ? '/index.html' : decoded).replace(/^[/\\]+/, '');
  const file = resolve(webRoot, relative);
  return file === webRoot || file.startsWith(webRoot + sep) ? file : undefined;
}

export interface UiServer {
  url: string;
  close: () => Promise<void>;
}

export function startUiServer(config: OfficeConfig, port: number): Promise<UiServer> {
  const webRoot = resolve(config.root, 'web');
  const store = new JobStore(config.home);
  const presenter = new Presenter();
  const clients = new Set<ServerResponse>();
  let latest = '';
  let tick = 0;

  const refresh = () => {
    const jobs = tick++ % RECONCILE_EVERY === 0 ? reconcile(store) : store.list();
    const { generatedAt: _ignored, ...comparable } = buildSnapshot(jobs);
    const next = JSON.stringify(comparable);
    if (next === latest) return;
    latest = next;
    const payload = `data: ${JSON.stringify(buildSnapshot(jobs))}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const onEvents = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`retry: 2000\ndata: ${JSON.stringify(buildSnapshot(store.list()))}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  };

  const onStatic = async (urlPath: string, res: ServerResponse) => {
    const file = resolveStatic(webRoot, urlPath);
    if (!file) return send(res, 400, 'Bad path');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      send(res, 404, 'Not found');
    }
  };

  /** Run a write action and push the new state to every open page straight away. */
  const onAction = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (!isTrustedWrite(req, port, config.allowedOrigins)) return sendJson(res, 403, { error: 'Requests must come from the office page on this computer.' });
    let body: Record<string, unknown>;
    try {
      body = await readJson(req, UPLOAD_ROUTES.has(path) ? MAX_UPLOAD_BODY_BYTES : MAX_BODY_BYTES);
    } catch (err) {
      return sendJson(res, 400, { error: (err as Error).message });
    }
    try {
      const str = (key: string) => (typeof body[key] === 'string' || typeof body[key] === 'number' ? String(body[key]) : undefined);
      let result: unknown;
      switch (path) {
        case '/api/assign':
          result = { job: assign(config, store, { agent: str('agent') ?? '', task: str('task') ?? '', project: str('project'), model: str('model'), attachments: body.attachments }) };
          break;
        case '/api/delegate':
          result = { job: delegate(config, store, { task: str('task') ?? '', project: str('project'), attachments: body.attachments }) };
          break;
        case '/api/reply':
          result = { job: reply(config, store, { job: str('job') ?? '', message: str('message') ?? '', model: str('model'), attachments: body.attachments }) };
          break;
        case '/api/cancel': {
          const outcome = cancel(store, str('job') ?? '');
          result = { job: outcome.job, cancelled: outcome.cancelled };
          break;
        }
        case '/api/present': {
          // By job number only: the page can open what an agent made, never an arbitrary folder.
          const job = requireJob(store, str('job') ?? '');
          try {
            return sendJson(res, 200, { job, ...await presenter.present(job.workspace) });
          } catch (err) {
            throw new ActionError((err as Error).message);
          }
        }
        default:
          return sendJson(res, 404, { error: 'Unknown action' });
      }
      sendJson(res, 200, result);
      latest = ''; // force the next refresh to broadcast
      refresh();
    } catch (err) {
      if (err instanceof ActionError) return sendJson(res, 400, { error: err.message });
      sendJson(res, 500, { error: 'The office could not do that. Check the terminal running `office ui`.' });
      console.error(err);
    }
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'POST' && path.startsWith('/api/')) return void onAction(req, res, path);
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    if (path === '/api/events') return onEvents(req, res);
    if (path === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(buildSnapshot(store.list())));
    }
    void onStatic(path, res);
  });

  const poll = setInterval(refresh, POLL_MS);
  const heartbeat = setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), HEARTBEAT_MS);

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolvePromise({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => {
          clearInterval(poll);
          clearInterval(heartbeat);
          clients.forEach((res) => res.end());
          void presenter.close();
          server.close(() => done());
        }),
      });
    });
  });
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Only this page, on this machine, may change anything, plus any HTTPS origins you allowed with
 * OFFICE_ALLOWED_ORIGINS (a reverse proxy such as `tailscale serve` in front of 127.0.0.1).
 */
export function isTrustedWrite(req: Pick<IncomingMessage, 'headers'>, port: number, extraOrigins: readonly string[] = []): boolean {
  const local = [`127.0.0.1:${port}`, `localhost:${port}`];
  const hosts = new Set([...local, ...extraOrigins.map((o) => new URL(o).host)]);
  const origins = new Set([...local.map((h) => `http://${h}`), ...extraOrigins]);
  const host = req.headers.host ?? '';
  const origin = req.headers.origin ?? '';
  const type = req.headers['content-type'] ?? '';
  return hosts.has(host)
    && origins.has(origin)
    && type.split(';')[0].trim().toLowerCase() === 'application/json';
}

async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error(limit > MAX_BODY_BYTES ? 'The attachments are too large. Send fewer or smaller images.' : 'Request too large');
    chunks.push(chunk as Buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Body must be JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Body must be a JSON object');
  return value as Record<string, unknown>;
}
