// browser-verify scenario — copied from templates/verify.template.mjs into a run dir.
// Do NOT import via relative paths: this file is relocated at runtime. Resolve
// everything through SKILL_DIR (set by the agent when invoking this scenario).

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const SKILL_DIR = process.env.SKILL_DIR;
const RUN_DIR = process.env.RUN_DIR;
const USER_DATA_DIR = process.env.USER_DATA_DIR;
const EXECUTABLE_PATH = process.env.EXECUTABLE_PATH;
const BROWSER_MODE = (process.env.BROWSER_MODE ?? 'persistent').toLowerCase();
const HEADLESS = process.env.HEADLESS === '1' || process.env.CI === '1';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30000);
// dwell between playwright actions so the proof video shows each state long
// enough to read instead of flickering past in a few frames. 0 disables.
const SLOWMO_MS = Number(process.env.SLOWMO_MS ?? 350);
const RUN_ID = process.env.RUN_ID ?? null;
const MODE = process.env.MODE ?? null;

if (!SKILL_DIR || !RUN_DIR) {
  console.error('Missing required env: SKILL_DIR, RUN_DIR');
  process.exit(2);
}
if (BROWSER_MODE === 'persistent' && (!USER_DATA_DIR || !EXECUTABLE_PATH)) {
  console.error(
    'BROWSER_MODE=persistent requires USER_DATA_DIR and EXECUTABLE_PATH (or set BROWSER_MODE=bundled)',
  );
  process.exit(2);
}

const { chromium } = await import(
  pathToFileURL(join(SKILL_DIR, 'node_modules', 'playwright', 'index.mjs')).href
);
const { attachListeners, step, finalize, assertRenderedValue } = await import(
  pathToFileURL(join(SKILL_DIR, 'scripts', 'capture-lib.mjs')).href
);

// pin DPR/zoom: persistent profiles inherit per-host zoom from the user's
// real chrome (Cmd+= on localhost is sticky across runs), and on retina
// displays the page renders at 2x — both make screenshots show only a
// fragment of the asserted UI. force a clean 1x.
const launchArgs = [
  '--disable-extensions',
  '--force-device-scale-factor=1',
];

const startedAt = new Date().toISOString();

let context;
if (BROWSER_MODE === 'bundled') {
  // hermetic mode: playwright's bundled chromium (arm64-native on apple
  // silicon, no rosetta), fresh context per run, no profile carryover.
  // for verify against a hermetic local stack we don't need real
  // cookies/SSO, so this is strictly better than persistent.
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOWMO_MS, args: launchArgs });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: join(RUN_DIR, 'video') },
    recordHar: { path: join(RUN_DIR, 'network.har'), content: 'omit' },
  });
} else {
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    executablePath: EXECUTABLE_PATH,
    headless: HEADLESS,
    slowMo: SLOWMO_MS,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: join(RUN_DIR, 'video') },
    recordHar: { path: join(RUN_DIR, 'network.har'), content: 'omit' },
    args: launchArgs,
  });
}

await context.tracing.start({ screenshots: true, snapshots: true });
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(TIMEOUT_MS);
const { counts } = attachListeners(page, RUN_DIR);

let passed = true;
let failedStep = null;
let finalUrl = null;

try {
  // TODO(model): STARTING_URL — replace with the URL this scenario targets.
  await page.goto('https://example.com/');

  // TODO(model): REPRO_STEPS — add one `step(...)` call per user-visible action.
  // Each call captures an a11y snapshot + steps.jsonl entry on failure.
  // Example:
  //   await step('click-submit', async () => {
  //     await page.getByRole('button', { name: 'Submit' }).click();
  //   }, { page, runDir: RUN_DIR });

  // TODO(model): ASSERTIONS — throw from within a step() to record a failure.
  //
  // For any DISPLAYED VALUE (panels, badges, toasts, error messages, computed
  // numbers), use `assertRenderedValue` — it scrolls the element into view,
  // checks the bbox is inside the viewport, captures an element-screenshot AND
  // a fullPage screenshot, then string-compares the rendered text against
  // `expected`. Plain `Locator.isVisible()` is NOT proof — it returns true for
  // off-screen elements that the screenshot won't show.
  //
  // Example:
  //   await step('assert-min-agl', async () => {
  //     await assertRenderedValue(page, page.getByTestId('stats-min-agl'), {
  //       expected: '-133 m',
  //       label: 'min-agl',
  //       runDir: RUN_DIR,
  //     });
  //   }, { page, runDir: RUN_DIR });
  //
  // For non-value assertions (route reached, modal opened), still call
  // `scrollIntoViewIfNeeded()` and `boundingBox()` before declaring success.

  finalUrl = page.url();
} catch (err) {
  passed = false;
  failedStep = String(err?.message ?? err);
  try {
    finalUrl = page.url();
  } catch {
    // ignore
  }
} finally {
  await finalize(
    {
      runId: RUN_ID,
      mode: MODE,
      passed,
      failedStep,
      startedAt,
      url: finalUrl,
      runDir: RUN_DIR,
    },
    { context, page, listenersCounts: counts },
  );
}

if (!passed) process.exit(1);
