# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **New logo.** The `>5_` mark replaces the generic monitor icon everywhere: the app's favicon (now an SVG, with the PNG as a fallback), install icons, the macOS app and the Windows desktop shortcut. The README opens with the wordmark, in a light and a dark version that follow GitHub's theme. The source files are in `brand/`.
- The public demo has a link-preview card, so a shared link shows the banner.

## [1.1.0] - 2026-10-03

### Added

- **Installable app (PWA).** The office page has a web app manifest, icons and a service worker. Install it from Chrome or Edge (the install icon in the address bar), from Safari on iOS (*Share → Add to Home Screen*) or on Android. It opens in its own window and still loads, with an "office not reachable" message, when the host is off.
- **Your phone, through your own tailnet.** `OFFICE_ALLOWED_ORIGINS` lets the office accept work from HTTPS origins you choose, such as a `tailscale serve` address. Only HTTPS origins are accepted, and the host still listens on `127.0.0.1` only.
- **Public demo.** `npm run build:demo` builds a static demo that simulates the office in the browser: agents plan, work, hand off, fail and finish, and visitors can give them tasks. `npm run demo` builds it and previews it locally. Deployed to GitHub Pages on every push to `main`.
- `LICENSE` (MIT), `SECURITY.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md` and this changelog.
- CI on Windows (`npm run check`) for every push and pull request.

### Changed

- The page's URLs are relative, so it also works under a sub-path such as `/5CR1PT3R5/` on GitHub Pages.
- The top bar wraps on narrow screens instead of crowding.
- The composer's example tasks moved to `web/js/examples.js`, shared with the demo.

## 1.0.0 - 2026-10-02 (before this repository)

### Added

- 25 agents: Tech Lead, Security, six engineering roles, a tech writer and one specialist for each of 16 languages, each on the cheapest model that does the job well.
- `office` CLI: `assign`, `delegate`, `reply`, `cancel`, `board`, `status`, `logs`, `roster` and `doctor`, with tab completion for PowerShell and zsh.
- Delegation: Ava plans and splits a project across the team (`office delegate`), or does her own part and hands off the rest (`HANDOFF.json`).
- `office ui`: a live pixel-art office with a New task box, follow-ups, image attachments and **▶ Present** to open what an agent built.
- Sandboxed agents: a folder per task, per-agent command allowlists, `git push` and `npm publish` always denied, a script runner, spend caps and timeouts.
- Desktop launchers for Windows and macOS.

[1.1.0]: https://github.com/RyanMH24/5CR1PT3R5/releases/tag/v1.1.0
