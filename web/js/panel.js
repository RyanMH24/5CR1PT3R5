// @ts-check
/**
 * The DOM side of the office: team list, agent detail card and header stats. Everything the
 * canvas shows is also here as real text and buttons, so the page works with a keyboard and a
 * screen reader. All user-supplied text (tasks, reports) is inserted as text nodes, never HTML.
 */
import { post } from './api.js';
import { AttachmentPicker } from './attachments.js';
import { describePlacement, teamOf } from './director.js';
import { DEMO } from './mode.js';
import { drawCharacter, lookFor, SPRITE_H, SPRITE_W } from './sprites.js';

/** @typedef {import('./director.js').AgentInfo} AgentInfo */
/** @typedef {import('./director.js').JobInfo} JobInfo */
/** @typedef {import('./director.js').Placement} Placement */
/** @typedef {{ generatedAt: string, spentTodayUsd: number, agents: AgentInfo[], jobs: JobInfo[] }} Snapshot */

/** Shape cues so state never depends on colour alone. */
const MOOD_ICON = /** @type {Record<import('./director.js').Mood, string>} */ ({
  working: '●', planning: '●', waiting: '◌', attention: '!', celebrating: '✓', idle: '○',
});
const statusText = (/** @type {Placement} */ p) => `${MOOD_ICON[p.mood]} ${describePlacement(p)}`;

const TEAM_HEADINGS = /** @type {Record<string, string>} */ ({
  Leadership: 'Leadership',
  Engineering: 'Engineering',
  Languages: 'Language Lab',
});

const ROOM_GUIDE = [
  ['Language Lab', 'a language specialist is working'],
  ['Workspace & Command Center', 'an engineer or lead is working'],
  ['Meeting Room', 'the Tech Lead is planning a delegated job'],
  ['Briefing Room', 'job queued, waiting for a turn or a dependency'],
  ['Needs You', 'last job failed or was blocked; check it'],
  ['Lounge, Pantry & Café', 'idle'],
];

export class Panel {
  /**
   * @param {{ roster: HTMLElement, detail: HTMLElement, stats: HTMLElement, onSelect: (id: string | null) => void }} els
   */
  constructor(els) {
    this.els = els;
    /** @type {Map<string, HTMLButtonElement>} */
    this.buttons = new Map();
    /** @type {Map<string, HTMLElement>} */
    this.teamLists = new Map();
    this.detailKey = '';
    /** @type {Map<string, File[]>} Images picked for a follow-up, by job id, until sent. */
    this.followupFiles = new Map();
    /** @type {AttachmentPicker | undefined} */
    this.followupPicker = undefined;
    els.roster.addEventListener('click', (event) => {
      const button = /** @type {HTMLElement} */ (event.target).closest('button[data-agent]');
      if (!button) return;
      const id = button.getAttribute('data-agent');
      els.onSelect(button.getAttribute('aria-pressed') === 'true' ? null : id);
    });
    els.detail.addEventListener('click', (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      const copyButton = target.closest('button[data-copy]');
      if (copyButton) void copy(/** @type {HTMLButtonElement} */ (copyButton));
      const cancelButton = target.closest('button[data-cancel]');
      if (cancelButton) void this.cancelJob(/** @type {HTMLButtonElement} */ (cancelButton));
      const presentButton = target.closest('button[data-present]');
      if (presentButton) void this.present(/** @type {HTMLButtonElement} */ (presentButton));
    });
    els.detail.addEventListener('submit', (event) => {
      const form = /** @type {HTMLElement} */ (event.target).closest('form.followup');
      if (!form) return;
      event.preventDefault();
      void this.sendFollowUp(/** @type {HTMLFormElement} */ (form));
    });
    els.detail.addEventListener('keydown', (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && target.matches('form.followup textarea')) {
        event.preventDefault();
        /** @type {HTMLFormElement} */ (target.closest('form')).requestSubmit();
      }
    });
  }

  /** @param {HTMLFormElement} form */
  async sendFollowUp(form) {
    const text = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('message'));
    const status = /** @type {HTMLElement} */ (form.querySelector('.form-status'));
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    const message = text.value.trim();
    if (!message) {
      status.textContent = 'Write what you want changed first.';
      status.dataset.tone = 'error';
      return;
    }
    button.disabled = true;
    const picker = this.followupPicker;
    const count = picker?.files.length ?? 0;
    if (count) {
      status.textContent = `Uploading ${count} image${count === 1 ? '' : 's'}…`;
      status.dataset.tone = 'info';
    }
    try {
      const { job } = await post('/api/reply', { job: form.dataset.job, message, attachments: await picker?.read() });
      text.value = '';
      picker?.clear();
      status.textContent = `✓ Sent as job #${job.id}${count ? ` with ${count} image${count === 1 ? '' : 's'}` : ''}.`;
      status.dataset.tone = 'ok';
    } catch (err) {
      status.textContent = (/** @type {Error} */ (err)).message;
      status.dataset.tone = 'error';
    } finally {
      button.disabled = false;
    }
  }

  /** Open what the agent built in a new tab. @param {HTMLButtonElement} button */
  async present(button) {
    const status = /** @type {HTMLElement | null} */ (button.parentElement?.querySelector('.present-status') ?? null);
    const say = (/** @type {string} */ text, /** @type {'ok' | 'error'} */ tone) => {
      if (!status) return;
      status.textContent = text;
      status.dataset.tone = tone;
    };
    // Open the tab during the click, or the browser treats it as a pop-up once we await.
    // The demo has nothing to show, so it skips the blank tab and just explains.
    const tab = DEMO ? null : window.open('', '_blank');
    button.disabled = true;
    try {
      const { url, root } = await post('/api/present', { job: button.dataset.present });
      if (!url) throw new Error('The office did not return a page to open.');
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
      say(`Showing ${root ?? 'the project'} at ${url}`, 'ok');
    } catch (err) {
      tab?.close();
      say((/** @type {Error} */ (err)).message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  /** @param {HTMLButtonElement} button */
  async cancelJob(button) {
    button.disabled = true;
    try {
      await post('/api/cancel', { job: button.dataset.cancel });
      button.textContent = 'Stopping…';
    } catch (err) {
      button.disabled = false;
      button.textContent = (/** @type {Error} */ (err)).message;
    }
  }

  /** @param {Snapshot} snapshot @param {Map<string, Placement>} placements @param {string | null} selectedId */
  update(snapshot, placements, selectedId) {
    this.renderStats(snapshot, placements);
    this.renderRoster(snapshot.agents, placements, selectedId);
    this.renderDetail(snapshot, placements, selectedId);
  }

  /** Refresh "running for 2m10s" style timers without rebuilding the card. */
  tick() {
    for (const el of this.els.detail.querySelectorAll('[data-since]')) {
      const since = Date.parse(el.getAttribute('data-since') ?? '');
      const until = el.getAttribute('data-until');
      el.textContent = duration((until ? Date.parse(until) : Date.now()) - since);
    }
  }

  /** @param {Snapshot} snapshot @param {Map<string, Placement>} placements */
  renderStats(snapshot, placements) {
    const moods = [...placements.values()].map((p) => p.mood);
    const working = moods.filter((m) => m === 'working' || m === 'planning').length;
    const waiting = moods.filter((m) => m === 'waiting').length;
    const attention = moods.filter((m) => m === 'attention').length;
    const parts = [`${working} working`, `${waiting} queued`];
    if (attention) parts.push(`${attention} need you`);
    parts.push(`${money(snapshot.spentTodayUsd)} today`);
    this.els.stats.textContent = parts.join(' · ');
  }

  /** @param {AgentInfo[]} agents @param {Map<string, Placement>} placements @param {string | null} selectedId */
  renderRoster(agents, placements, selectedId) {
    for (const agent of agents) {
      let button = this.buttons.get(agent.id);
      if (!button) {
        button = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'agent', 'data-agent': agent.id },
          avatar(agent.id, 2),
          h('span', { class: 'agent-main' },
            h('span', { class: 'agent-line' },
              h('span', { class: 'agent-name' }, agent.name),
              h('span', { class: 'agent-role' }, agent.title)),
            h('span', { class: 'agent-status' })),
          h('span', { class: `chip chip-${agent.model}` }, agent.model)));
        this.buttons.set(agent.id, button);
        this.teamList(agent.team).append(h('li', {}, button));
      }
      const placement = placements.get(agent.id);
      const status = /** @type {HTMLElement} */ (button.querySelector('.agent-status'));
      if (placement) {
        const text = statusText(placement);
        if (status.textContent !== text) status.textContent = text;
        status.dataset.mood = placement.mood;
      }
      button.setAttribute('aria-pressed', String(agent.id === selectedId));
    }
  }

  /** One labelled list per team, created on first use. @param {string} team */
  teamList(team) {
    let list = this.teamLists.get(team);
    if (!list) {
      const id = `team-${team.toLowerCase()}`;
      list = h('ul', { class: 'roster', 'aria-labelledby': id });
      this.els.roster.append(h('h3', { id, class: 'team-heading' }, TEAM_HEADINGS[team] ?? team), list);
      this.teamLists.set(team, list);
    }
    return list;
  }

  /** @param {Snapshot} snapshot @param {Map<string, Placement>} placements @param {string | null} selectedId */
  renderDetail(snapshot, placements, selectedId) {
    const agent = snapshot.agents.find((a) => a.id === selectedId);
    const placement = agent ? placements.get(agent.id) : undefined;
    // The team list shows each teammate's state, so a teammate finishing must refresh the card too.
    const team = placement?.job ? teamOf(snapshot.jobs, placement.job.id).map((j) => j.state) : [];
    const key = JSON.stringify([selectedId, placement?.mood, placement?.job, team]);
    if (key === this.detailKey) return;
    this.detailKey = key;

    const { detail } = this.els;
    // Keep a half-typed follow-up and the focus when the card refreshes underneath it.
    const draft = /** @type {HTMLTextAreaElement | null} */ (detail.querySelector('form.followup textarea'));
    const draftText = draft?.value ?? '';
    const draftFocused = draft !== null && draft === document.activeElement;
    const hadFocus = detail.contains(document.activeElement);
    detail.replaceChildren(agent && placement ? agentCard(agent, placement, snapshot) : overview());
    const newDraft = /** @type {HTMLTextAreaElement | null} */ (detail.querySelector('form.followup textarea'));
    if (newDraft && draftText) newDraft.value = draftText;
    this.mountAttachments();
    if (newDraft && draftFocused) newDraft.focus();
    else if (hadFocus) /** @type {HTMLElement | null} */ (detail.querySelector('h2'))?.focus();
    this.tick();
  }

  /** Give the follow-up form an attachment picker, keeping chosen images across card refreshes. */
  mountAttachments() {
    this.followupPicker = undefined;
    const form = /** @type {HTMLFormElement | null} */ (this.els.detail.querySelector('form.followup'));
    const slot = form?.querySelector('.followup-attachments');
    if (!form || !slot) return;
    const jobId = form.dataset.job ?? '';
    let files = this.followupFiles.get(jobId);
    if (!files) this.followupFiles.set(jobId, files = []);
    const status = /** @type {HTMLElement} */ (form.querySelector('.form-status'));
    this.followupPicker = new AttachmentPicker(/** @type {HTMLElement} */ (slot), {
      dropZone: form,
      pasteTarget: /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('message')),
      files,
      onError: (message) => {
        status.textContent = message;
        status.dataset.tone = 'error';
      },
    });
  }
}

// ── cards ───────────────────────────────────────────────────────────────────

function overview() {
  return h('div', { class: 'overview' },
    h('h2', { id: 'detail-h', tabindex: '-1' }, 'How to read the office'),
    h('p', { class: 'muted' }, 'Select an agent on the floor or in the list to see their plan, files and report.'),
    h('dl', { class: 'guide' }, ROOM_GUIDE.flatMap(([room, meaning]) => [h('dt', {}, room), h('dd', {}, meaning)])),
    h('p', { class: 'muted' }, 'Give someone a job with the New task box above, or from PowerShell or zsh:'),
    command('office assign powershell "Script that reports disk usage"'));
}

/** @param {AgentInfo} agent @param {Placement} placement @param {Snapshot} snapshot */
function agentCard(agent, placement, snapshot) {
  const job = placement.job;
  const history = snapshot.jobs.filter((j) => j.agentId === agent.id && j.finishedAt).length;
  return h('div', { class: 'card' },
    h('header', { class: 'card-head' },
      avatar(agent.id, 4),
      h('div', {},
        h('h2', { id: 'detail-h', tabindex: '-1' }, agent.name),
        h('p', { class: 'muted' }, `${agent.title} · `, h('span', { class: `chip chip-${agent.model}` }, agent.model)),
        h('p', { class: 'muted small' }, agent.specialty))),
    h('p', { class: 'status', 'data-mood': placement.mood }, statusText(placement)),
    job ? jobSection(job, agent, snapshot) : h('div', { class: 'empty' },
      h('p', {}, `${agent.name} hasn't had a job yet. Use the New task box above to give them one.`)),
    history ? h('p', { class: 'muted small' }, `${history} finished job${history === 1 ? '' : 's'} · office status --all`) : null);
}

/** @param {JobInfo} job @param {AgentInfo} agent @param {Snapshot} snapshot */
function jobSection(job, agent, snapshot) {
  const active = job.state === 'running' || job.state === 'queued';
  const nameOf = (/** @type {string} */ id) => snapshot.agents.find((a) => a.id === id)?.name ?? id;
  const team = teamOf(snapshot.jobs, job.id);
  const lead = job.planId === undefined ? undefined : snapshot.jobs.find((j) => j.id === job.planId);
  const todos = job.progress.todos;
  const done = todos.filter((t) => t.status === 'completed').length;
  const cost = job.result ? `${money(job.result.costUsd)} of ${money(job.budgetUsd)} cap` : `cap ${money(job.budgetUsd)}`;
  return h('section', { class: 'job', 'aria-labelledby': 'job-h' },
    h('h3', { id: 'job-h' }, `Job #${job.id} `, h('span', { class: `state state-${job.state}` }, job.state)),
    taskText(job.task),
    h('dl', { class: 'meta' },
      job.state === 'running' ? [h('dt', {}, 'Now'), h('dd', {}, job.progress.activity)] : null,
      job.startedAt ? [h('dt', {}, 'Time'), h('dd', { 'data-since': job.startedAt, 'data-until': job.finishedAt ?? null })] : null,
      [h('dt', {}, 'Cost'), h('dd', {}, cost)],
      [h('dt', {}, 'Folder'), h('dd', { class: 'mono' }, job.workspace)],
      job.planId !== undefined
        ? [h('dt', {}, 'From'), h('dd', {}, `${lead ? nameOf(lead.agentId) : 'Tech Lead'}, job #${job.planId}`)] : null),
    team.length ? [
      h('h4', {}, `Team · ${team.length} brought in`),
      h('ul', { class: 'team-list' }, team.map((t) => h('li', {},
        h('span', { class: `state state-${t.state}` }, t.state), ' ',
        h('strong', {}, `#${t.id} ${nameOf(t.agentId)}`), `: ${t.task.split('\n')[0]}`))),
    ] : null,
    todos.length ? [
      h('h4', {}, `Plan · ${done}/${todos.length}`),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(todos.length), 'aria-valuenow': String(done), 'aria-label': 'Plan progress' },
        h('span', { style: `width:${(done / todos.length) * 100}%` })),
      h('ol', { class: 'plan' }, todos.map((t) => h('li', { class: `todo todo-${t.status}` },
        h('span', { class: 'todo-mark', 'aria-hidden': 'true' }, t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'),
        h('span', { class: 'sr-only' }, t.status === 'completed' ? 'Done: ' : t.status === 'in_progress' ? 'In progress: ' : 'To do: '),
        t.status === 'in_progress' ? t.activeForm ?? t.content : t.content))),
    ] : null,
    job.progress.filesTouched.length ? [
      h('h4', {}, 'Files'),
      h('ul', { class: 'files mono' }, job.progress.filesTouched.map((f) => h('li', {}, f))),
    ] : null,
    job.progress.blocked.length ? [
      h('h4', { class: 'warn' }, 'Blocked by the sandbox'),
      h('ul', { class: 'blocked' }, job.progress.blocked.map((b) => h('li', {}, b))),
    ] : null,
    job.error ? [h('h4', { class: 'danger' }, 'Error'), h('p', { class: 'report danger' }, job.error)]
      : job.result?.summary ? [h('h4', {}, 'Report'), h('p', { class: 'report' }, job.result.summary)] : null,
    active ? h('button', { type: 'button', class: 'danger-button', 'data-cancel': String(job.id) }, `Stop job #${job.id}`) : null,
    !active && job.startedAt ? h('div', { class: 'present' },
      h('button', { type: 'button', class: 'primary', 'data-present': String(job.id), 'aria-describedby': `present-hint-${job.id}` }, '▶ Present'),
      h('span', { id: `present-hint-${job.id}`, class: 'hint' }, 'Opens what was built in a new tab'),
      h('p', { class: 'present-status form-status', role: 'status' })) : null,
    !active && job.kind === 'task' && job.startedAt ? followUp(job, agent) : null,
    h('div', { class: 'commands' }, command(`office logs ${job.id} -f`)));
}

/** Plain-English follow-up; the agent continues the same conversation and folder. @param {JobInfo} job @param {AgentInfo} agent */
function followUp(job, agent) {
  const id = `followup-${job.id}`;
  return h('form', { class: 'followup', 'data-job': String(job.id) },
    h('label', { for: id }, `Follow up with ${agent.name}`),
    h('textarea', { id, name: 'message', rows: '3', placeholder: `e.g. "Add a --dry-run option" or "Put my logo in the header"` }),
    h('div', { class: 'followup-attachments' }), // filled by Panel.mountAttachments
    h('div', { class: 'form-row' },
      h('button', { type: 'submit', class: 'primary' }, `Send to ${agent.name}`),
      h('span', { class: 'hint' }, 'Ctrl+Enter')),
    h('p', { class: 'form-status', role: 'status' }));
}

const TASK_PREVIEW = 180;

/** Delegated tasks can be long specs; fold them so the plan stays in view. @param {string} task */
function taskText(task) {
  if (task.length <= TASK_PREVIEW) return h('p', { class: 'task' }, task);
  return h('details', { class: 'task' },
    h('summary', {}, `${task.slice(0, TASK_PREVIEW).trimEnd()}… `, h('span', { class: 'more' }, 'Show full task')),
    h('p', {}, task));
}

/** @param {string} text */
function command(text) {
  return h('div', { class: 'command' },
    h('code', {}, text),
    h('button', { type: 'button', class: 'copy', 'data-copy': text, 'aria-label': `Copy command: ${text}` }, 'Copy'));
}

/** Small canvas portrait using the same sprite as the floor. @param {string} id @param {number} scale */
function avatar(id, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_W * scale;
  canvas.height = SPRITE_H * scale;
  canvas.className = 'avatar';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(scale, scale);
    drawCharacter(ctx, lookFor(id), { facing: 'down', walking: false, seated: false, typing: false, frame: 0 }, SPRITE_W / 2, SPRITE_H);
  }
  return canvas;
}

/** @param {HTMLButtonElement} button */
async function copy(button) {
  const text = button.getAttribute('data-copy') ?? '';
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Press Ctrl+C';
    const code = button.previousElementSibling;
    if (code) window.getSelection()?.selectAllChildren(code);
  }
  setTimeout(() => { button.textContent = 'Copy'; }, 1500);
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** @typedef {Node | string | number | null | undefined | false} Leaf */
/** @typedef {Leaf | Leaf[] | Array<Leaf | Leaf[]>} Child */

/**
 * Tiny element builder. Attribute values of null/undefined are skipped.
 * @param {string} tag
 * @param {Record<string, string | null | undefined>} props
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value);
  }
  const append = (/** @type {Child} */ child) => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(append);
    else el.append(typeof child === 'object' ? child : String(child));
  };
  children.forEach(append);
  return el;
}

/** @param {number} usd */
export const money = (usd) => (usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

/** @param {number} ms */
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
