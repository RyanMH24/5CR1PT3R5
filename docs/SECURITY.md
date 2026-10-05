# Security

5CR1PT3R5 starts AI agents that write and run code on your computer, with your Claude subscription. This page covers what protects you, what doesn't, and how to report a problem.

## Reporting a vulnerability

Use **Report a vulnerability** on this repository's **Security** tab. It opens a private advisory that only the maintainer can see. Please don't open a public issue for security problems.

Include what you did, what happened, and the version (`package.json`). You should hear back within a week.

## Supported versions

| Version | Supported |
|---|---|
| 1.x | Yes |

## Threat model

### Who it's for

One person, on their own computer. It isn't a multi-user service and has no accounts. Anyone who can send it work can spend your Claude usage and make agents run code on your machine, so the boundaries below exist to keep everyone else out.

### The office host (`office ui`)

- **Listens on `127.0.0.1` only.** It is never reachable from your network unless you put a proxy in front of it yourself.
- **Every request that changes something** (assign, delegate, reply, cancel, present) must:
  - carry a `Host` header for the office itself, which blocks DNS rebinding;
  - carry an `Origin` header for the office page, which blocks other websites;
  - have a JSON content type, which forces a CORS preflight. The host never answers preflights, so a cross-site form or `fetch` can't get through.
- **Request bodies are capped** at 64 KB, or about 34 MB for routes that carry images.
- **Static files** are served only from `web/`. Paths that try to climb out (`..`, encoded variants) are rejected.

### Reaching it from your phone (`OFFICE_ALLOWED_ORIGINS`)

By default nothing but the page on the same computer can send work. If you set `OFFICE_ALLOWED_ORIGINS`, writes from those origins are accepted too.

- Only `https://` origins are accepted. Anything else in the variable is ignored, because plain HTTP could be read or changed on the way.
- Put a proxy you control in front of it, such as `tailscale serve`, which only devices on your own tailnet can reach. **Never** expose the host with a public tunnel (`tailscale funnel`, ngrok, a port forward). Anyone who finds the URL could run code on your computer.
- The host itself still listens on `127.0.0.1` only. The proxy is the only way in.

### Agents

Each agent runs `claude -p` inside its own task folder:

- File tools are confined to that folder. Reviewers (lead, security, QA) can also read the other agents' folders in `Agents Work`.
- Shell commands must match the agent's allowlist in [`src/roster.ts`](../src/roster.ts). Anything else is denied automatically, never left waiting for approval.
- `git push`, `git remote`, `npm publish`, `npm login` and `npm adduser` are always denied.
- Scripts are checked and run through [`src/run-script.ts`](../src/run-script.ts). It runs only files inside the task folder, with a timeout.
- Each job has a hard spend cap (`--max-budget-usd`) and a time limit (`OFFICE_JOB_TIMEOUT_MIN`, 45 minutes by default).

**What this does not do:** the allowlist limits which programs an agent can *start*. It is not an operating-system sandbox. An allowed tool such as `node`, `python` or `npm` can still run any code, and that code runs as you. **Review what agents build before you run it outside their folder,** and don't give them tasks involving secrets you wouldn't paste into a chat.

### ▶ Present

Present serves a finished project's files from a separate static server on a random `127.0.0.1` port. Because it's a different origin, a page an agent wrote can't send requests to the office host. Hidden files (`.env`, `.git`) are never served, and nothing is installed or built.

### Attachments

Images are checked by their bytes, not their file name: PNG, JPEG, GIF, WebP, AVIF, SVG and ICO only, with limits on count and size. They are saved under the task's `attachments/` folder, and an earlier upload is never overwritten.

### The public demo

The GitHub Pages demo is static files only. Its office is simulated in the browser ([`web/js/demo.js`](../web/js/demo.js)): it has no server and stores nothing, and what visitors type never leaves their browser. It can't reach anyone's office host.

### Local data

Job files and logs in `.office/` contain your task text and the agents' output. They stay on your computer, and `.gitignore` keeps them out of git.
