// @ts-check
/**
 * Which office this page talks to. The demo build (scripts/build-demo.ts) marks the page
 * `<html data-mode="demo" data-repo="…">`; without that it's the real one behind `office ui`.
 */
const root = document.documentElement;
export const DEMO = root.dataset.mode === 'demo';
export const REPO_URL = root.dataset.repo ?? '';
