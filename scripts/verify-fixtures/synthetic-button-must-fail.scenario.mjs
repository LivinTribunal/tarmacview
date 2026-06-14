// regression fixture for issue #289.
//
// mirrors the tautological PR #269 verify run: navigates to a page that has
// nothing to do with the change, injects a button via evaluate_script, then
// asserts against the values it just wrote. scripts/verify-lint-scenario.sh
// MUST reject this file — if you're touching the verify pipeline and this
// fixture starts passing the lint, the gate has regressed.
//
// not a real scenario; never executed in CI. lives outside frontend/src so
// vite/tsc/eslint/vitest don't pick it up.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const SKILL_DIR = process.env.SKILL_DIR;
const RUN_DIR = process.env.RUN_DIR;

const { chromium } = await import(
  pathToFileURL(join(SKILL_DIR, 'node_modules', 'playwright', 'index.mjs')).href
);
const { attachListeners, step, finalize, assertRenderedValue } = await import(
  pathToFileURL(join(SKILL_DIR, 'scripts', 'capture-lib.mjs')).href
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = context.pages()[0] ?? (await context.newPage());
attachListeners(page, RUN_DIR);

// wrong page for the change — issue #289's reference was MissionTabNav.tsx but
// the agent landed on /super-admin/users.
await page.goto('http://localhost:5174/super-admin/users');

// synthetic-DOM injection — the bug this fixture exists to catch.
await step('inject-busy-button', async () => {
  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.textContent = 'Computing…';
    btn.style.backgroundColor = 'var(--tv-accent-busy)';
    btn.style.color = 'var(--tv-accent-text)';
    btn.id = 'synthetic-busy-button';
    document.body.appendChild(btn);
  });
}, { page, runDir: RUN_DIR });

// tautological assertion — checks values the scenario just wrote.
await step('assert-busy-button', async () => {
  await assertRenderedValue(page, page.locator('#synthetic-busy-button'), {
    expected: 'Computing…',
    label: 'busy-button-light',
    runDir: RUN_DIR,
  });
}, { page, runDir: RUN_DIR });

await finalize(
  { passed: true, startedAt: new Date().toISOString(), url: page.url(), runDir: RUN_DIR },
  { context, page, listenersCounts: { console: 0, pageErrors: 0, networkErrors: 0 } },
);
