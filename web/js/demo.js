// @ts-check
/**
 * The office without the office: a simulation for the public demo build (GitHub Pages).
 *
 * It stands in for the local server. The page sends it the requests it would POST to `office ui`
 * and gets back the snapshots the server would push over SSE. Jobs walk through scripted steps
 * (plan checklist, files, commands, a report) on the real scheduler's rules: one job at a time per
 * agent, dependencies first, a delegated project fanned out by the Tech Lead. Nothing leaves the
 * browser and no agent really runs.
 *
 * No DOM and no timers: the page calls tick(now), so tests can run an afternoon in a millisecond.
 */
import { EXAMPLE_TASKS } from './examples.js';

/** @typedef {import('./director.js').AgentInfo & { budgetUsd: number }} DemoAgent */
/** @typedef {import('./director.js').JobInfo} JobInfo */
/** @typedef {{ generatedAt: string, spentTodayUsd: number, agents: DemoAgent[], jobs: JobInfo[] }} DemoSnapshot */
/** @typedef {{ activity: string, blocked: string }} BlockedStep */
/** @typedef {[content: string, activeForm: string, steps: Array<string | BlockedStep>]} PlanItem */
/** @typedef {{ todo: number, activity: string, file?: string, blocked?: string, ms: number }} Step */
/** @typedef {{ todos: Array<{ content: string, activeForm: string }>, steps: Step[], summary: string }} Script */
/**
 * @typedef {object} Sim
 * @property {JobInfo} job
 * @property {Script} script
 * @property {number} [startMs]
 * @property {string} [failWith]  End as failed with this error instead of a report.
 */

const MAX_FINISHED = 60;
const MAX_ACTIVE = 24; // a visitor can't queue the demo into the ground
const AUTOPILOT_ACTIVE = 4; // keep the floor busy but leave desks free for the visitor
const AUTOPILOT_GAP_MS = /** @type {const} */ ([18_000, 32_000]);
const STEP_MS = /** @type {const} */ ([2_500, 5_500]);
const PLAN_STEP_MS = /** @type {const} */ ([2_000, 3_500]);
const COST = /** @type {Record<string, readonly [number, number]>} */ ({ haiku: [0.03, 0.22], sonnet: [0.12, 0.75], opus: [0.3, 1.1] });
const PLAN_COST = /** @type {const} */ ([0.03, 0.08]);
const LEAD = 'tech-lead';
const ENDED = new Set(['failed', 'cancelled', 'blocked']);
const AUTOPILOT = [
  'bash', 'typescript', 'frontend', 'csharp', '!A landing page for my bakery with an online order form and a small API',
  'devops', 'cpp', 'database', 'php', 'security', 'java', '!A quiz app with a leaderboard, a SQLite database and tests',
  'kotlin', 'ruby', 'javascript', 'swift', 'c', 'writer', 'backend', 'fullstack', 'zsh', 'python',
]; // "!" = hand the whole project to Ava

export const PRESENT_IN_DEMO = 'In the real app, ▶ Present opens what the agent built in a new tab. This demo is simulated, so nothing was built. Install 5CR1PT3R5 to try it for real.';

export class DemoOffice {
  /**
   * @param {DemoAgent[]} agents
   * @param {{ now: number, seed?: number }} options
   */
  constructor(agents, { now, seed = now }) {
    this.agents = agents;
    this.rand = mulberry32(seed);
    /** @type {Sim[]} */
    this.sims = [];
    /** @type {Set<string>} */
    this.slugs = new Set();
    this.nextAuto = now + 8_000;
    this.autoIndex = 0;
    this.seedHistory(now);
    this.tick(now);
  }

  /** A believable office to land on: a few reports to read, one problem, work in progress. */
  seedHistory(/** @type {number} */ now) {
    const ago = (/** @type {number} */ s) => now - s * 1000;
    this.replay('powershell', EXAMPLE_TASKS.powershell, ago(42 * 60));
    this.replay('python', EXAMPLE_TASKS.python, ago(26 * 60));
    this.replay('rust', EXAMPLE_TASKS.rust, ago(4 * 60),
      'Stopped at the $1.50 budget cap before `cargo test` passed. Reply "keep going", or retry with -m opus.');
    this.replay('frontend', EXAMPLE_TASKS.frontend, ago(20));
    this.delegate('A todo web app with a Node API, SQLite storage, tests and a README', now);
    this.replay('go', EXAMPLE_TASKS.go, ago(-25)); // finishes 25 s after the page opens
  }

  /**
   * Add a job that started in the past and ends at `endMs`, so it shows up mid-flight or finished.
   * @param {string} agentId @param {string} task @param {number} endMs @param {string} [failWith]
   */
  replay(agentId, task, endMs, failWith) {
    const sim = this.add({ agentId, task, kind: 'task' }, endMs);
    sim.startMs = endMs - total(sim.script);
    sim.failWith = failWith;
    sim.job.createdAt = iso(sim.startMs - 1500);
    sim.job.startedAt = iso(sim.startMs);
    sim.job.state = 'running';
  }

  // ── requests from the page ────────────────────────────────────────────────

  /**
   * Same routes and error style as the real server, answered in the page.
   * @param {import('./api.js').Route} path
   * @param {Record<string, unknown>} body
   * @param {number} now
   * @returns {import('./api.js').Reply}
   */
  handle(path, body, now) {
    const str = (/** @type {string} */ key) => (typeof body[key] === 'string' || typeof body[key] === 'number' ? String(body[key]).trim() : '');
    const adds = path === '/api/assign' || path === '/api/delegate' || path === '/api/reply';
    if (adds && this.active().length >= MAX_ACTIVE) throw new Error('The demo office is full. Wait for a few jobs to finish.');
    let reply;
    switch (path) {
      case '/api/assign': {
        const agent = this.agents.find((a) => a.id === str('agent'));
        if (!agent) throw new Error('Pick someone to do it.');
        reply = { job: this.assign(agent.id, required(str('task')), now, str('model') || undefined) };
        break;
      }
      case '/api/delegate':
        reply = { job: this.delegate(required(str('task')), now) };
        break;
      case '/api/reply': {
        const previous = this.find(str('job'));
        if (previous.job.kind === 'plan') throw new Error('Follow up with a teammate’s job, not the plan.');
        const sim = this.add({ agentId: previous.job.agentId, task: required(str('message')), kind: 'task', workspace: previous.job.workspace, followUp: previous }, now);
        reply = { job: sim.job };
        break;
      }
      case '/api/cancel': {
        const sim = this.find(str('job'));
        const cancelled = sim.job.state === 'queued' || sim.job.state === 'running';
        if (cancelled) Object.assign(sim.job, { state: 'cancelled', finishedAt: iso(now), error: 'Stopped by you.' });
        reply = { job: sim.job, cancelled };
        break;
      }
      case '/api/present':
        throw new Error(PRESENT_IN_DEMO);
      default:
        throw new Error('Unknown action');
    }
    this.tick(now);
    return structuredClone(reply);
  }

  /** @param {string} agentId @param {string} task @param {number} now @param {string} [model] */
  assign(agentId, task, now, model) {
    return this.add({ agentId, task, kind: 'task', model }, now).job;
  }

  /** Ava plans first; her teammates' jobs appear when the plan is done. @param {string} task @param {number} now */
  delegate(task, now) {
    return this.add({ agentId: LEAD, task, kind: 'plan' }, now).job;
  }

  /** @param {string} id */
  find(id) {
    const sim = this.sims.find((s) => String(s.job.id) === id);
    if (!sim) throw new Error(`There's no job #${id}.`);
    return sim;
  }

  /**
   * @param {{ agentId: string, task: string, kind: 'task' | 'plan', model?: string, workspace?: string, dependsOn?: number[], planId?: number, followUp?: Sim }} spec
   * @param {number} now
   */
  add(spec, now) {
    const agent = this.agents.find((a) => a.id === spec.agentId);
    if (!agent) throw new Error(`Unknown agent: ${spec.agentId}`);
    const slug = spec.workspace ? '' : this.uniqueSlug(slugify(spec.task));
    const workspace = spec.workspace ?? `~/Projects/Agents Work/${slug}`;
    const script = spec.kind === 'plan' ? this.planScript()
      : spec.followUp ? this.followUpScript(spec.task, spec.followUp)
        : this.taskScript(agent, spec.task, workspace.split('/').pop() ?? 'task');
    /** @type {Sim} */
    const sim = {
      script,
      job: {
        id: this.sims.length + 1,
        agentId: agent.id,
        kind: spec.kind,
        state: 'queued',
        task: spec.task,
        model: spec.kind === 'plan' ? 'opus' : spec.model ?? agent.model,
        workspace,
        budgetUsd: agent.budgetUsd,
        dependsOn: spec.dependsOn ?? [],
        planId: spec.planId,
        createdAt: iso(now),
        progress: { activity: 'Queued', todos: [], filesTouched: [], blocked: [], toolCalls: 0 },
      },
    };
    this.sims.push(sim);
    return sim;
  }

  // ── the clock ─────────────────────────────────────────────────────────────

  /** Move every job along to `now`. @param {number} now */
  tick(now) {
    for (const sim of this.sims) if (sim.job.state === 'running') this.advance(sim, now);
    this.startReady(now);
    this.autopilot(now);
    this.startReady(now);
  }

  /** @param {number} now */
  snapshot(now) {
    const done = this.sims.filter((s) => s.job.finishedAt);
    /** @type {DemoSnapshot} */
    const snapshot = {
      generatedAt: iso(now),
      spentTodayUsd: done.reduce((sum, s) => sum + (s.job.result?.costUsd ?? 0), 0),
      agents: this.agents,
      jobs: [...done.slice(-MAX_FINISHED), ...this.active()].map((s) => s.job),
    };
    // A copy: the page compares each snapshot with the last one to announce what changed.
    return structuredClone(snapshot);
  }

  active() {
    return this.sims.filter((s) => s.job.state === 'queued' || s.job.state === 'running');
  }

  /** @param {Sim} sim @param {number} now */
  advance(sim, now) {
    const { steps } = sim.script;
    const elapsed = now - (sim.startMs ?? now);
    let at = 0;
    let index = 0;
    while (index < steps.length - 1 && elapsed >= at + steps[index].ms) at += steps[index++].ms;
    if (elapsed >= total(sim.script)) this.finish(sim, (sim.startMs ?? now) + total(sim.script));
    else this.show(sim, index);
  }

  /** @param {Sim} sim @param {number} index */
  show(sim, index) {
    const { todos, steps } = sim.script;
    const seen = steps.slice(0, index + 1);
    const current = steps[index];
    sim.job.progress = {
      activity: current.activity,
      todos: todos.map((t, i) => ({ ...t, status: i < current.todo ? 'completed' : i === current.todo ? 'in_progress' : 'pending' })),
      filesTouched: [...new Set(seen.flatMap((s) => (s.file ? [s.file] : [])))],
      blocked: seen.flatMap((s) => (s.blocked ? [s.blocked] : [])),
      toolCalls: index + 1,
    };
  }

  /** @param {Sim} sim @param {number} endMs */
  finish(sim, endMs) {
    this.show(sim, sim.script.steps.length - 1);
    const { job } = sim;
    job.progress.todos = job.progress.todos.map((t) => ({ ...t, status: sim.failWith ? t.status : 'completed' }));
    job.progress.activity = sim.failWith ? 'Stopped' : 'Done';
    job.finishedAt = iso(endMs);
    const [low, high] = job.kind === 'plan' ? PLAN_COST : COST[job.model] ?? COST.sonnet;
    const costUsd = sim.failWith ? job.budgetUsd : Math.min(job.budgetUsd, round2(low + this.rand() * (high - low)));
    if (sim.failWith) {
      job.state = 'failed';
      job.error = sim.failWith;
      job.result = { costUsd, summary: '', isError: true };
      return;
    }
    job.state = 'done';
    const summary = job.kind === 'plan' ? this.fanOut(sim, endMs) : sim.script.summary;
    job.result = { costUsd, summary, isError: false };
  }

  /** Queued jobs start once their agent's desk is free and everything they wait on is done. @param {number} now */
  startReady(now) {
    const busy = new Set(this.sims.filter((s) => s.job.state === 'running').map((s) => s.job.agentId));
    for (const sim of this.sims) {
      const { job } = sim;
      if (job.state !== 'queued') continue;
      const deps = job.dependsOn.map((id) => this.sims[id - 1]?.job);
      const broken = deps.find((d) => d && ENDED.has(d.state));
      if (broken) {
        Object.assign(job, { state: 'blocked', finishedAt: iso(now), error: `Job #${broken.id} ${broken.state}, so this one can't start.` });
      } else if (!busy.has(job.agentId) && deps.every((d) => d?.state === 'done')) {
        busy.add(job.agentId);
        Object.assign(job, { state: 'running', startedAt: iso(now) });
        sim.startMs = now;
        this.show(sim, 0);
      }
    }
  }

  /** Every so often, give an idle agent something to do so the floor never goes quiet. @param {number} now */
  autopilot(now) {
    if (now < this.nextAuto) return;
    this.nextAuto = now + AUTOPILOT_GAP_MS[0] + this.rand() * (AUTOPILOT_GAP_MS[1] - AUTOPILOT_GAP_MS[0]);
    if (this.active().length >= AUTOPILOT_ACTIVE) return;
    const occupied = new Set(this.active().map((s) => s.job.agentId));
    for (let tries = 0; tries < AUTOPILOT.length; tries++) {
      const next = AUTOPILOT[this.autoIndex++ % AUTOPILOT.length];
      const agentId = next.startsWith('!') ? LEAD : next;
      if (occupied.has(agentId) || !this.agents.some((a) => a.id === agentId)) continue;
      if (next.startsWith('!')) this.delegate(next.slice(1), now);
      else this.assign(agentId, EXAMPLE_TASKS[agentId], now);
      return;
    }
  }

  /** Ava's plan is done: queue the team in the project's folder. @param {Sim} plan @param {number} now */
  fanOut(plan, now) {
    const parts = planTeam(plan.job.task);
    /** @type {number[]} */
    const ids = [];
    for (const part of parts) {
      const sim = this.add({
        agentId: part.agentId,
        task: `${part.verb}: ${plan.job.task}`,
        kind: 'task',
        workspace: plan.job.workspace,
        planId: plan.job.id,
        dependsOn: part.after.map((i) => ids[i]),
      }, now);
      ids.push(sim.job.id);
    }
    const names = parts.map((p) => this.agents.find((a) => a.id === p.agentId)?.name ?? p.agentId);
    return `Split it into ${parts.length} jobs: ${names.join(', ')}. Builders work in parallel; QA tests once they're done, then Theo writes the README.`;
  }

  // ── scripts ───────────────────────────────────────────────────────────────

  planScript() {
    return this.script([['Plan the work', 'Planning the work', ['Reading the request', 'Splitting the work across the team', 'Writing the plan']]], '', PLAN_STEP_MS);
  }

  /** @param {DemoAgent} agent @param {string} task @param {string} slug */
  taskScript(agent, task, slug) {
    const role = ROLES[agent.id];
    if (role) {
      const [plan, summary] = role(slug, task);
      return this.script(plan, summary);
    }
    const lang = LANGS[agent.id] ?? LANGS.javascript;
    const file = lang.file(slug);
    const cmd = (/** @type {string} */ c) => c.replaceAll('{f}', file).replaceAll('{b}', snake(slug));
    return this.script([
      ['Read the request and plan it', 'Planning it', ['Reading the task', 'Planning: 4 steps']],
      [`Write ${file}`, `Writing ${file}`, [`Writing ${file}`, `Editing ${file}`]],
      ['Check and test it', 'Checking and testing', [`Running: ${cmd(lang.check)}`, `Running: ${cmd(lang.test)}`]],
      ['Write a short README', 'Writing the README', ['Writing README.md']],
    ], `${title(slug)} is ready in ${file}. \`${cmd(lang.check)}\` is clean and \`${cmd(lang.test)}\` passes. README.md says how to run it and what each option does.`);
  }

  /** @param {string} message @param {Sim} previous */
  followUpScript(message, previous) {
    const file = previous.job.progress.filesTouched[0] ?? 'README.md';
    return this.script([
      ['Make the change', 'Making the change', [`Reading ${file}`, `Editing ${file}`]],
      ['Re-run the checks', 'Re-running the checks', ['Running the checks again']],
    ], `Done: "${message}". Updated ${file} in the same folder and re-ran the checks; everything still passes.`);
  }

  /**
   * @param {PlanItem[]} plan  One checklist item per entry. A step that starts "Writing x" or
   *   "Editing x" touches file x; an object is a step the sandbox refused.
   * @param {string} summary
   * @param {readonly [number, number]} [ms]
   * @returns {Script}
   */
  script(plan, summary, ms = STEP_MS) {
    return {
      todos: plan.map(([content, activeForm]) => ({ content, activeForm })),
      steps: plan.flatMap(([, , steps], todo) => steps.map((step) => {
        const activity = typeof step === 'string' ? step : step.activity;
        const file = /^(?:Writing|Editing) (\S+)$/.exec(activity)?.[1];
        return {
          todo, activity, file, blocked: typeof step === 'string' ? undefined : step.blocked,
          ms: Math.round(ms[0] + this.rand() * (ms[1] - ms[0])),
        };
      })),
      summary,
    };
  }

  /** @param {string} slug */
  uniqueSlug(slug) {
    let name = slug;
    for (let n = 2; this.slugs.has(name); n++) name = `${slug}-${n}`;
    this.slugs.add(name);
    return name;
  }
}

// ── who builds what ─────────────────────────────────────────────────────────

/** @type {Record<string, (slug: string, task: string) => [PlanItem[], string]>} */
const ROLES = {
  'tech-lead': () => [[
    ['Read the existing code', 'Reading the code', ['Reading package.json', 'Searching for TODO and FIXME', 'Reading src/index.ts']],
    ['Write up the architecture', 'Writing up the architecture', ['Writing ARCHITECTURE.md', 'Editing ARCHITECTURE.md']],
    ['List the next steps', 'Listing next steps', ['Writing NEXT-STEPS.md']],
  ], 'Reviewed the project. ARCHITECTURE.md maps how it fits together and names three risks; NEXT-STEPS.md lists five changes, smallest first.'],
  security: () => [[
    ['Map where input comes in', 'Mapping the inputs', ['Reading src/server.ts', 'Searching for req.body and query strings']],
    ['Check dependencies', 'Checking dependencies', ['Running: npm audit']],
    ['Fix the safe ones', 'Fixing the safe ones', ['Editing src/server.ts', 'Running: npm test']],
    ['Write the review', 'Writing the review', ['Writing SECURITY-REVIEW.md']],
  ], 'Found 4 issues. Fixed 2 safely (missing input validation, a verbose error page) and tests still pass. The other 2 need your call; SECURITY-REVIEW.md explains each with a suggested fix.'],
  backend: (slug) => [[
    ['Set up the project', 'Setting up the project', ['Writing package.json', 'Running: npm install']],
    ['Build the routes', 'Building the routes', ['Writing src/server.ts', `Writing src/routes/${slug}.ts`, 'Writing src/validate.ts']],
    ['Test the API', 'Testing the API', ['Writing test/api.test.ts', 'Running: npm test']],
  ], `The ${title(slug)} API is in src/: create, list, update and delete, with input validation and JSON errors. 14 tests pass (\`npm test\`). Start it with \`npm start\`.`],
  frontend: (slug) => [[
    ['Pick the look', 'Picking the look', [`Running: design-search "${slug}" --design-system`, `Writing design-system/${slug}/MASTER.md`]],
    ['Build the page', 'Building the page', ['Writing index.html', 'Writing styles.css', 'Writing app.js']],
    ['Check phone and desktop widths', 'Checking layouts', ['Checking 375px, 768px and 1440px', 'Checking contrast and focus states']],
  ], `Built the ${title(slug)} page: index.html, styles.css and app.js, following design-system/${slug}/MASTER.md. It works from 375px up, passes WCAG AA contrast, and every control is reachable by keyboard.`],
  fullstack: (slug) => [[
    ['Design the data', 'Designing the data', ['Writing db/schema.sql']],
    ['Build the API', 'Building the API', ['Writing src/server.ts', 'Writing src/db.ts']],
    ['Build the UI', 'Building the UI', ['Writing public/index.html', 'Writing public/app.js']],
    ['Test it end to end', 'Testing end to end', ['Writing test/app.test.ts', 'Running: npm test']],
  ], `${title(slug)} works end to end: a SQLite database, a small Node API and a page that talks to it. 9 tests pass. Run \`npm start\` and open http://localhost:3000.`],
  devops: () => [[
    ['Write the workflow', 'Writing the workflow', ['Writing .github/workflows/ci.yml']],
    ['Containerise it', 'Containerising it', ['Writing Dockerfile', 'Writing .dockerignore', 'Running: docker build -t app .']],
    ['Ship it', 'Shipping it', [{ activity: 'Running: git push', blocked: 'git push: always denied, so pushing is yours to do' }, 'Writing DEPLOY.md']],
  ], 'CI runs install, lint and tests on every push and pull request, with the npm cache to keep it fast. The Docker image builds (142 MB). I couldn’t push (the sandbox never allows it), so DEPLOY.md lists the two commands to run.'],
  qa: () => [[
    ['Read the code under test', 'Reading the code', ['Reading src/server.ts', 'Reading src/routes']],
    ['Write the tests', 'Writing tests', ['Writing test/routes.test.ts', 'Writing test/edge-cases.test.ts']],
    ['Run them and report', 'Running the tests', ['Running: npm test', 'Writing BUGS.md']],
  ], 'Added 23 tests; 21 pass. The 2 failures are real bugs: an empty title is accepted, and deleting a missing item returns 500 instead of 404. Both are in BUGS.md with steps to reproduce.'],
  database: (slug) => [[
    ['Model the data', 'Modelling the data', ['Writing schema.sql']],
    ['Add sample data', 'Adding sample data', ['Writing seed.sql', `Running: sqlite3 ${snake(slug)}.db < schema.sql`]],
    ['Write the common queries', 'Writing queries', ['Writing queries.sql', 'Running: EXPLAIN QUERY PLAN']],
  ], `schema.sql has 6 tables with foreign keys and indexes on every lookup column; seed.sql adds realistic sample rows. queries.sql covers the 8 everyday queries, and each one uses an index.`],
  writer: () => [[
    ['Read the project', 'Reading the project', ['Reading package.json', 'Reading src/']],
    ['Write the README', 'Writing the README', ['Writing README.md', 'Editing README.md']],
  ], 'README.md covers what it is, install, usage with copy-paste examples, configuration and troubleshooting. Every command in it was checked against package.json.'],
};

/** @type {Record<string, { file: (slug: string) => string, check: string, test: string }>} */
const LANGS = {
  powershell: { file: (s) => `${pascal(s)}.ps1`, check: 'node run-script check {f}', test: 'node run-script run {f} -WhatIf' },
  zsh: { file: (s) => `${s}.zsh`, check: 'node run-script check {f}', test: 'node run-script run {f} --dry-run' },
  bash: { file: (s) => `${s}.sh`, check: 'shellcheck {f}', test: 'node run-script run {f}' },
  python: { file: (s) => `${snake(s)}.py`, check: 'python -m py_compile {f}', test: 'python -m pytest -q' },
  javascript: { file: (s) => `${s}.js`, check: 'node --check {f}', test: 'node --test' },
  typescript: { file: (s) => `src/${s}.ts`, check: 'npx tsc --noEmit', test: 'npm test' },
  php: { file: (s) => `${s}.php`, check: 'php -l {f}', test: 'php vendor/bin/phpunit' },
  ruby: { file: (s) => `${snake(s)}.rb`, check: 'ruby -c {f}', test: 'ruby -Itest test/all.rb' },
  java: { file: (s) => `src/main/java/${pascal(s)}.java`, check: 'mvn -q compile', test: 'mvn -q test' },
  csharp: { file: (s) => `${pascal(s)}/Program.cs`, check: 'dotnet build', test: 'dotnet test' },
  go: { file: () => 'main.go', check: 'go vet ./...', test: 'go test ./...' },
  c: { file: (s) => `${snake(s)}.c`, check: 'gcc -Wall -Wextra -o {b} {f}', test: './{b} sample.txt' },
  cpp: { file: (s) => `${snake(s)}.cpp`, check: 'g++ -std=c++20 -Wall -o {b} {f}', test: './{b}' },
  rust: { file: () => 'src/main.rs', check: 'cargo build', test: 'cargo test' },
  swift: { file: (s) => `Sources/${pascal(s)}/main.swift`, check: 'swift build', test: 'swift test' },
  kotlin: { file: (s) => `src/main/kotlin/${pascal(s)}.kt`, check: 'gradle build', test: 'gradle test' },
};

/** Words in a project request that bring a specialist in, and the part they'd own. */
const PARTS = /** @type {const} */ ([
  ['database', /\b(database|sql|sqlite|postgres|mysql|schema|tables?)\b/, 'Design the database'],
  ['backend', /\b(api|server|backend|endpoints?|rest|graphql)\b/, 'Build the API'],
  ['frontend', /\b(ui|page|site|website|landing|frontend|form|dashboard|web app)\b/, 'Design and build the UI'],
  ['devops', /\b(deploy|docker|ci|pipeline|github actions|hosting)\b/, 'Set up CI and deployment'],
]);
const LANG_WORDS = /** @type {Record<string, RegExp>} */ ({
  powershell: /\bpowershell\b/, zsh: /\bzsh\b/, bash: /\bbash\b/, python: /\bpython\b/, javascript: /\bjavascript\b/,
  typescript: /\btypescript\b/, java: /\bjava\b/, csharp: /c#|\bcsharp\b|\.net\b/, go: /\bgolang\b|\bin go\b/,
  rust: /\brust\b/, php: /\bphp\b/, ruby: /\bruby\b/, swift: /\bswift(ui)?\b/, kotlin: /\b(kotlin|android)\b/, cpp: /c\+\+/,
});

/**
 * Who Ava brings in for a project, in order; `after` holds indexes of parts that must finish first.
 * @param {string} task
 * @returns {Array<{ agentId: string, verb: string, after: number[] }>}
 */
export function planTeam(task) {
  const text = task.toLowerCase();
  /** @type {Array<{ agentId: string, verb: string, after: number[] }>} */
  const parts = [];
  for (const [agentId, words] of Object.entries(LANG_WORDS)) {
    if (words.test(text)) parts.push({ agentId, verb: 'Write the code', after: [] });
  }
  for (const [agentId, words, verb] of PARTS) {
    if (agentId === 'devops' || !words.test(text)) continue;
    // The API is built on the schema, so it waits for it.
    const after = agentId === 'backend' ? parts.flatMap((p, i) => (p.agentId === 'database' ? [i] : [])) : [];
    parts.push({ agentId, verb, after });
  }
  if (parts.length === 0) parts.push({ agentId: 'fullstack', verb: 'Build it', after: [] });
  const builders = parts.map((_, i) => i);
  if (PARTS[3][1].test(text)) parts.push({ agentId: 'devops', verb: PARTS[3][2], after: builders });
  parts.push({ agentId: 'qa', verb: 'Test it and report bugs', after: builders });
  parts.push({ agentId: 'writer', verb: 'Write the README', after: [parts.length - 1] });
  return parts;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const STOP = new Set(('a an the my me for to of and that with in on by it is are every all from i you your our ' +
  'write make create build script small tiny simple fast tool app please some new').split(' '));

/** "Rename all photos in a folder by the date" -> "rename-photos-folder". @param {string} task */
export function slugify(task) {
  const words = task.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  return words.slice(0, 3).join('-') || 'task';
}

/** @param {string} text */
function required(text) {
  if (!text) throw new Error('Describe what needs to be done first.');
  return text;
}

/** @param {Script} script */
const total = (script) => script.steps.reduce((sum, s) => sum + s.ms, 0);
/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();
/** @param {number} n */
const round2 = (n) => Math.round(n * 100) / 100;
/** @param {string} slug */
const pascal = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
/** @param {string} slug */
const snake = (slug) => slug.replaceAll('-', '_');
/** @param {string} slug */
const title = (slug) => { const words = slug.split('-').join(' '); return words[0].toUpperCase() + words.slice(1); };

/** Small seeded PRNG so a test run is repeatable. @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
