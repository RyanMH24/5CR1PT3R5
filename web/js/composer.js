// @ts-check
/**
 * "New task" form: pick an agent (or let the Tech Lead split the work), describe the job in plain
 * English, send. The text goes to the agent verbatim; agents are told to work from plain English.
 */
import { post } from './api.js';
import { AttachmentPicker } from './attachments.js';
import { EXAMPLE_TASKS } from './examples.js';

/** @typedef {import('./director.js').AgentInfo} AgentInfo */
/** @typedef {import('./director.js').JobInfo} JobInfo */

export const DELEGATE = '__delegate';
const TEAM_LABELS = /** @type {Record<string, string>} */ ({
  Leadership: 'Leadership',
  Engineering: 'Engineering roles',
  Languages: 'Language specialists',
});

export class Composer {
  /**
   * @param {HTMLFormElement} form
   * @param {{ onAssigned: (job: JobInfo) => void }} hooks
   */
  constructor(form, hooks) {
    this.form = form;
    this.hooks = hooks;
    this.agentSelect = /** @type {HTMLSelectElement} */ (form.elements.namedItem('agent'));
    this.text = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('task'));
    this.project = /** @type {HTMLInputElement} */ (form.elements.namedItem('project'));
    this.model = /** @type {HTMLSelectElement} */ (form.elements.namedItem('model'));
    this.submitButton = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    this.status = /** @type {HTMLElement} */ (form.querySelector('.composer-status'));
    /** @type {AgentInfo[]} */
    this.agents = [];
    this.attachments = new AttachmentPicker(/** @type {HTMLElement} */ (form.querySelector('#composer-attachments')), {
      dropZone: form,
      pasteTarget: this.text,
      onError: (message) => this.say(message, 'error'),
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.send();
    });
    this.text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.send();
      }
    });
    this.agentSelect.addEventListener('change', () => this.refreshHints());
  }

  /** Fill the agent picker once; later snapshots only change who is busy, not the roster. @param {AgentInfo[]} agents */
  setAgents(agents) {
    if (this.agents.length === agents.length) return;
    this.agents = agents;
    const current = this.agentSelect.value;
    this.agentSelect.replaceChildren(new Option('Ava decides: split it across the team', DELEGATE));
    for (const team of [...new Set(agents.map((a) => a.team))]) {
      const group = document.createElement('optgroup');
      group.label = TEAM_LABELS[team] ?? team;
      for (const a of agents.filter((agent) => agent.team === team)) group.append(new Option(`${a.name} — ${a.title} (${a.model})`, a.id));
      this.agentSelect.append(group);
    }
    if (current) this.agentSelect.value = current;
    this.refreshHints();
  }

  /** Point the form at an agent picked on the floor or in the list. @param {string | null} agentId */
  setTarget(agentId) {
    if (agentId && this.agents.some((a) => a.id === agentId)) {
      this.agentSelect.value = agentId;
      this.refreshHints();
    }
  }

  refreshHints() {
    const agent = this.agents.find((a) => a.id === this.agentSelect.value);
    this.model.disabled = !agent;
    this.model.closest('label')?.toggleAttribute('hidden', !agent);
    this.text.placeholder = agent
      ? `Tell ${agent.name} what you need, e.g. "${example(agent)}"`
      : 'Describe the whole project, e.g. "A todo web app with a Node API, SQLite storage, tests and a README"';
    this.submitButton.textContent = agent ? `Send to ${agent.name}` : 'Send to Ava';
  }

  async send() {
    const task = this.text.value.trim();
    if (!task) {
      this.say('Describe what needs to be done first.', 'error');
      this.text.focus();
      return;
    }
    const agentId = this.agentSelect.value;
    const project = this.project.value.trim() || undefined;
    this.submitButton.disabled = true;
    const count = this.attachments.files.length;
    this.say(count ? `Uploading ${count} image${count === 1 ? '' : 's'}…` : 'Sending…', 'info');
    try {
      const attachments = await this.attachments.read();
      const { job } = agentId === DELEGATE
        ? await post('/api/delegate', { task, project, attachments })
        : await post('/api/assign', { agent: agentId, task, project, model: this.model.value || undefined, attachments });
      const who = this.agents.find((a) => a.id === job.agentId)?.name ?? job.agentId;
      const withImages = count ? ` with ${count} image${count === 1 ? '' : 's'}` : '';
      this.say(job.kind === 'plan'
        ? `✓ Job #${job.id}${withImages}: ${who} is planning it. Subtasks will be handed out automatically.`
        : `✓ Job #${job.id}${withImages} → ${who}. Watch them head to their desk.`, 'ok');
      this.text.value = '';
      this.attachments.clear();
      this.hooks.onAssigned(job);
    } catch (err) {
      this.say((/** @type {Error} */ (err)).message, 'error');
    } finally {
      this.submitButton.disabled = false;
    }
  }

  /** @param {string} message @param {'ok' | 'error' | 'info'} tone */
  say(message, tone) {
    this.status.textContent = message;
    this.status.dataset.tone = tone;
  }
}

/** A plausible plain-English request for the agent's specialty. @param {AgentInfo} agent */
function example(agent) {
  return EXAMPLE_TASKS[agent.id] ?? `Something in ${agent.specialty}`;
}
