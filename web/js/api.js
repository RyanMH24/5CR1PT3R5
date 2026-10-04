// @ts-check
/** Write calls to the local office server. Errors carry the server's human-readable message. */

/** @typedef {'/api/assign' | '/api/delegate' | '/api/reply' | '/api/cancel' | '/api/present'} Route */
/** @typedef {{ job: import('./director.js').JobInfo, cancelled?: boolean, url?: string, root?: string }} Reply */

/** @typedef {(path: Route, body: Record<string, unknown>) => Reply} Backend */

/** @type {Backend | undefined} */
let override;

/** Answer requests in the page instead of over the network (the demo build). @param {Backend} handler */
export function useBackend(handler) {
  override = handler;
}

/**
 * @param {Route} path
 * @param {Record<string, unknown>} body
 * @returns {Promise<Reply>}
 */
export async function post(path, body) {
  if (override) return override(path, body);
  let res;
  try {
    res = await fetch(path.slice(1), { // relative, so the page also works under a sub-path
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Can’t reach the office. Is `office ui` still running?');
  }
  /** @type {any} */
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page; fall through to the generic message.
  }
  if (!res.ok) throw new Error(data.error ?? `The office said no (HTTP ${res.status}).`);
  return data;
}
