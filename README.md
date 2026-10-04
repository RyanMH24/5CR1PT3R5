# 5CR1PT3R5

A personal office of 25 AI agents built on [Claude Code](https://claude.com/claude-code): leads, engineers, and one
specialist for every major language. Tell any of them what you need in plain English, from the
browser or from PowerShell or zsh. Each one writes the code in its own folder while you watch its
plan, current step and spend live.

**[▶ Try the live demo](https://GITHUB_USER.github.io/5CR1PT3R5/)**: a simulated office in your browser. Give the agents tasks and watch them plan, work and hand off. Nothing really runs.

[Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

```
 5CR1PT3R5  2 working · 1 queued · 9 idle · spent today $0.31
────────────────────────────────────────────────────────────────────────────
● Dana    PowerShell Specialist haiku   #12 ██████░░ 3/4  41s  Running: node run-script check backup.ps1
● Leo     Full-Stack Engineer  sonnet  #13 ██░░░░░░ 1/5  2m10s Editing src/api/todos.ts
◌ Iris    QA Engineer          sonnet  1 queued
○ Kai     Zsh Scripter         haiku   idle
```

## Install

Requires Node.js 22.18+ and Claude Code, logged in to your Claude subscription.

```powershell
# PowerShell (Windows)
.\scripts\install.ps1
```

```zsh
# zsh (macOS / Linux / WSL)
zsh scripts/install.zsh
```

Both install scripts put `office` on your PATH (via `npm link`) and add tab completion for agents, job numbers and flags.
Run `office doctor` to check the setup, including which language toolchains are installed. A missing toolchain means that specialist can write code but can't build or run it.

**Desktop launcher (Windows):** `.\scripts\install-shortcut.ps1` puts an **5CR1PT3R5** shortcut on your Desktop. Double-click it to start the local host and open http://127.0.0.1:4777. If the host is already running, it just opens the page.

### On a Mac

1. **On the PC:** `.\scripts\pack-mac.ps1` writes `5CR1PT3R5-mac.zip` to your Desktop. It leaves out `node_modules` and `.office` (this PC's jobs and logs).
2. **Copy it over** (iCloud Drive, OneDrive, a USB stick…) and unzip it into a Projects folder, e.g. `~/Projects/5CR1PT3R5`. Agents' work goes in `Agents Work` next to it.
3. **On the Mac:** install Node.js 22.18+ (`brew install node`) and [Claude Code](https://claude.com/claude-code), log in, then:

```zsh
cd ~/Projects/5CR1PT3R5
zsh scripts/install.zsh       # office command + tab completion
zsh scripts/install-app.zsh   # 5CR1PT3R5.app in ~/Applications
```

Open **5CR1PT3R5** from Spotlight or Launchpad, or drag it to the Dock. Like the Windows shortcut, it opens the page if the host is running; otherwise it opens a Terminal window that starts the host. Close that window to stop it. While the host runs, the Mac won't idle-sleep (`caffeinate -i`), so agents aren't paused mid-job; closing the lid on battery still sleeps. If you move the folder, run `install-app.zsh` again.

On a Mac, agents use Claude Code's Bash tool (its PowerShell tool is Windows-only). Dana can still write `.ps1` scripts, but she can only check and run them if PowerShell is installed (`brew install --cask powershell`). The Mac keeps its own jobs and history; nothing syncs between it and the PC.

## Use

```sh
office roster                                   # the team, their models, who's busy
office assign powershell "Backup Documents to D:\Backup, keep 7 days"
office assign zsh "Clean node_modules older than 30 days" -p dev-cleanup
office delegate "Todo web app: Node API, SQLite, tests and a README"
office board                                    # live view (Ctrl+C to leave)
office status 12                                # plan checklist, files, cost, report
office logs 12 -f                               # every step as it happens
office reply 12 "Add a -WhatIf switch"          # follow-up; the agent keeps its context
office cancel 12
```

## Watch them work: `office ui`

```sh
office ui            # opens http://127.0.0.1:4777 in your browser
```

A pixel-art office that updates live.

**Install it as an app.** The page is an installable web app (PWA), so it gets its own window and a Start menu, Dock or home-screen icon, with no Electron and no app store:

| Where | How |
|---|---|
| Chrome or Edge (Windows, macOS, Linux) | Open http://127.0.0.1:4777, then click the install icon in the address bar |
| Android (Chrome) | ⋮ → *Install app*, from your tailnet address (below) |
| iPhone or iPad (Safari) | Share → *Add to Home Screen*, from your tailnet address (below) |

The app opens even when the host is off and tells you to start `office ui`. It never shows old jobs as live.

**From your phone.** The host only listens on this computer. To reach it from your own phone, put [Tailscale](https://tailscale.com) on both devices and let `tailscale serve` give the office a private HTTPS address on your tailnet:

```powershell
tailscale serve --bg http://127.0.0.1:4777          # prints https://<pc-name>.<tailnet>.ts.net
[Environment]::SetEnvironmentVariable('OFFICE_ALLOWED_ORIGINS', 'https://<pc-name>.<tailnet>.ts.net', 'User')
# restart office ui (or the desktop shortcut) so it picks the variable up
```

On a Mac, put `export OFFICE_ALLOWED_ORIGINS=https://<mac-name>.<tailnet>.ts.net` in `~/.zshrc` instead. Only devices signed in to your tailnet can open that address. Use `serve`, **never** `funnel`: funnel would put the office on the public internet. **▶ Present** opens projects on the PC's own `127.0.0.1`, so use it from the PC. See [SECURITY.md](SECURITY.md).

**Give work in plain English.** Use the **New task** box. Pick who should do it, or choose *Ava decides* to have the Tech Lead split a bigger project across the team, then describe what you need the way you'd say it out loud, e.g. *"make me a script that renames my photos by the date they were taken"*. Click an agent on the floor to point the box at them. When a job finishes, its card has a **Follow up** box: the agent keeps the context and the folder, so *"add a --dry-run option"* just works. Running jobs have a **Stop** button.

**Attach images.** Use **📎 Attach images** in the New task box or a Follow up box to add photos, business logos or product shots. You can also drag them onto the form or paste them into the text box. They're saved in the project's `attachments/` folder before the agent starts, and the task tells the agent they're there, so *"put my logo in the header"* just works. On a delegated project the whole team shares them. Limits: PNG, JPEG, GIF, WebP, AVIF, SVG or ICO; up to 10 images, 10 MB each, 25 MB in total. The type is checked from each file's contents, so a renamed non-image is refused. Earlier uploads are never overwritten: a second `logo.png` is saved as `logo-2.png`.

**See what was built with ▶ Present.** Every finished job's card has a **▶ Present** button. It opens what the agent built in a new browser tab, so you don't need an editor or a terminal. It looks for an `index.html` in `dist/`, `build/`, `out/`, `site/`, `public/`, `www/`, `docs/` or the task folder itself, in that order. If there isn't one, it uses the first HTML page it finds. It serves the files as they are and never installs or builds anything. A project that needs `npm run build` first says so, and scripts-only folders say there's no page to show (their report explains how to run them). Each project gets its own `127.0.0.1` port, so its pages can't send commands to the office. Hidden files like `.env` are never served, and reloading the tab shows a follow-up's changes.

Where an agent sits tells you what it's doing:

| Room | Meaning |
|---|---|
| Language Lab | a language specialist is working; their monitor lights up and the bubble shows the current step and plan progress |
| Workspace / Command Center | an engineer or a lead is working |
| Meeting Room | Ava is planning a delegated job |
| Briefing Room | job queued (waiting for its turn or a dependency) |
| Needs You | the last job failed or was blocked (shown for 15 min) |
| Lounge / Pantry / Café | idle; every so often an idle agent wanders off for coffee, a snack, the whiteboard or small talk in the hall, then sits back down |

Click an agent, or pick one from the team list, to see its plan checklist, files, cost and report.
The host only listens on `127.0.0.1`. Requests that change anything must come from the office page itself (Host, Origin and JSON content type are all checked), so other websites can't send your agents work. Everything on the canvas is also in the sidebar as text, so the page works with a keyboard and a screen reader.

**Making it your own:** the art is split from the logic.
- [`web/js/map.js`](web/js/map.js) is the floor plan: rooms, doors, furniture, seats, and which desk belongs to whom. It is pure data, so you can redesign the office or generate it from a tile editor.
- [`web/js/sprites.js`](web/js/sprites.js) holds the characters. Swap `drawCharacter` for one that draws frames from your own sprite sheets.
- [`web/js/renderer.js`](web/js/renderer.js) draws the furniture: one small function per furniture type in the `DRAW` table.

**Every prompt gets its own folder** in `Projects/Agents Work/`, named after the task (`photo-renamer`, `photo-renamer-2`, …), so one job never overwrites another. Follow-ups continue in the same folder, and a delegated project's subtasks share one folder. To keep working in a folder on purpose, give its name under Options (or `-p <name>` on the CLI). To point an agent at an existing project somewhere else, use `-p <path>`.

## The team

Each agent does one job. Use the id, the name or an alias anywhere an agent is expected (`js`, `c#`, `c++`, `sql`, `dana`, …).

**Leadership:** Ava (`tech-lead`, opus, $3.00) plans, leads and reviews · Omar (`security`, opus, $2.50) audits and hardens.

**Ava brings people in.** There are two ways to give Ava a project:

- `office delegate` (or *Ava decides* on the page): Ava only plans. One cheap planning call splits the request across the team, and she writes no code.
- `office assign ava "…"`: Ava does her own part first, such as architecture, scaffolding and the shared interfaces. Then she brings in the teammates the rest needs by writing `HANDOFF.json` in her folder (same shape as a delegate plan). When her job finishes, their jobs are queued in the same folder, in parallel where they don't depend on each other. She can add a final review for herself at the end. Small jobs and pure reviews she still does alone.

Her report ends with who she brought in. On the page, her job card has a **Team** list with each teammate's state, each teammate's card says who brought them in, and `office status <job>` shows the same. Only jobs you give Ava, and follow-ups to them, can bring people in. A review job she handed to herself can't hand out more work. A broken `HANDOFF.json` is reported in her summary and her own work still counts as done.

**Priya designs.** Priya (`frontend`) is the only agent with the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) design database: styles, palettes, font pairings and UX rules. On a new UI project she runs one design-system search and saves the result to `design-system/<project>/MASTER.md`. Later jobs and teammates read that file instead of searching again. When Ava plans or hands off a project with a UI, she gives Priya the look and feel first and tells the others to follow `MASTER.md`. Priya skips the database for logic-only fixes, docs and questions.

**Engineering:** Marcus (`backend`) · Priya (`frontend`, UI/UX, HTML/CSS) · Leo (`fullstack`) · Sam (`devops`) · Iris (`qa`) · Rosa (`database`, SQL), all on sonnet · Theo (`writer`, haiku).

**Language Lab, one specialist per language:**

| Language | Agent | Model | | Language | Agent | Model |
|---|---|---|---|---|---|---|
| PowerShell | Dana (`powershell`) | haiku | | Java | Mateo (`java`) | sonnet |
| Zsh | Kai (`zsh`) | haiku | | C# | Sofia (`csharp`) | sonnet |
| Bash | Finn (`bash`) | haiku | | Go | Gus (`go`) | sonnet |
| Python | Noor (`python`) | haiku | | C | Cyrus (`c`) | sonnet |
| JavaScript | Jade (`javascript`) | haiku | | C++ | Hana (`cpp`) | sonnet |
| TypeScript | Tess (`typescript`) | haiku | | Rust | Rook (`rust`) | sonnet |
| PHP | Pia (`php`) | haiku | | Swift | Suki (`swift`) | sonnet |
| Ruby | Remy (`ruby`) | haiku | | Kotlin | Kira (`kotlin`) | sonnet |

Haiku specialists have a $0.75 cap per job and Sonnet specialists $1.50. Agents, their models, caps, allowed commands and coding standards are all defined in [`src/roster.ts`](src/roster.ts).

## How it saves tokens

- **Model routing.** Each role defaults to the cheapest model that does it well. Override per job with `-m sonnet` or `-m opus`, e.g. when a Haiku job struggles: `office reply 12 "keep going" -m sonnet`.
- **Delegation.** `office delegate` has Opus write only a plan: one tool-free call with structured output, typically about $0.05. Haiku and Sonnet agents then do the work, in parallel where the plan allows.
- **Lean sessions.** Agents load no skills, no MCP servers, and only the tools their role needs. Their persona prompt is short, because it is re-sent on every turn.
- **Design data on demand.** Agents still load no skills. Priya reaches the ui-ux-pro-max database through [`bin/design-search.mjs`](src/design-search.ts), which asks for compact markdown output (about 3 KB for a design system, against 8 KB by default). That means four persona lines for one agent, instead of seven skill descriptions in every turn and a 16 KB SKILL.md on every use. Install it with `claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill`, then `claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill`. It needs Python. `office doctor` shows whether it's found, and `OFFICE_UIUX_DIR` points at a copy that wasn't installed as a plugin.
- **Hard caps.** Every job runs with `--max-budget-usd`. Change it per job with `-b 1.50`.
- **Replies resume the session**, so a follow-up doesn't pay to re-read the project.

## Sandbox

Each agent runs `claude -p --restricted` inside its task folder:

- File tools are confined to that folder.
- Shell commands must match the agent's allowlist (e.g. `npm`, `node`, `git commit`, `pytest`). Anything else is denied automatically, never left waiting for approval.
- `git push`, `npm publish` and similar are always denied.
- Scripts are checked and run through [`bin/run-script.mjs`](src/run-script.ts). It only runs files inside the task folder, with a timeout, and uses the PowerShell parser (plus PSScriptAnalyzer if installed) for `.ps1` files.

Blocked actions are listed on `office status <job>`, so you know what wasn't verified.

The allowlist limits which programs an agent can start. It is not an OS sandbox: an allowed tool like `node` or `npm` can still run arbitrary code. Review what agents build before running it outside their folder.

## Design

```
office assign ──► JobStore (.office/jobs/<id>.json) ──► dispatch()
                                                        │ desk free?
                                                        ▼
                                  detached worker (one per busy agent, exits when idle)
                                                        │ claude -p --output-format stream-json
                                                        ▼
                         events.ts folds the stream into Progress ──► board / status / logs
                                                                              └─► office ui (SSE) ──► web/
```

The web page is plain ES modules with JSDoc types, checked by the same `tsc` run. `director.js` (who sits where), `pathfinding.js` and `map.js` are pure and covered by tests, including one that checks every seat can be reached on foot.

- **No daemon.** State is one JSON file per job, written atomically (temp file + rename). Any terminal can read it.
- **Desks** (`src/desk.ts`) are pid lock files: one worker per agent, so jobs for the same agent queue FIFO. Locks left by crashed workers are taken over.
- **Dependencies** (`--after`, a delegated plan, or Ava's handoff) start a job only when everything before it is `done`. If an upstream job fails, its dependents become `blocked`.
- A worker re-checks its queue after releasing its desk. That closes the race with a job assigned while it was finishing.

## Develop

```sh
npm install
npm run check      # tsc --noEmit + node:test suite
npm run demo       # build the simulated demo into dist/demo and preview it
```

The TypeScript runs directly on Node (built-in type stripping), with no build step and no runtime dependencies.

**The demo** is the same page with [`web/js/demo.js`](web/js/demo.js) standing in for the host. It simulates jobs on the real scheduler's rules, and its team is generated from `src/roster.ts` at build time. Every push to `main` deploys it to GitHub Pages ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)); turn this on once under *Settings → Pages → Source: GitHub Actions*. For how it all fits together, see [ARCHITECTURE.md](ARCHITECTURE.md).

| Variable | Default | Purpose |
|---|---|---|
| `OFFICE_PROJECTS_DIR` | `Projects/Agents Work` (next to the `5CR1PT3R5` folder) | where each prompt's folder is created |
| `OFFICE_HOME` | `./.office` | jobs, logs, desk locks |
| `OFFICE_CLAUDE_BIN` | `claude` on PATH, then `~/.local/bin` | Claude Code executable |
| `OFFICE_JOB_TIMEOUT_MIN` | `45` | kill jobs that run longer |
| `OFFICE_START_WORKERS` | `1` | `0` queues jobs without starting agents (tests, embedding hosts) |
| `OFFICE_ALLOWED_ORIGINS` | *(none)* | comma-separated HTTPS origins (e.g. a `tailscale serve` address) that may send work, besides this computer |

## License

[MIT](LICENSE) © 2026 Ryan M. Hernandez
