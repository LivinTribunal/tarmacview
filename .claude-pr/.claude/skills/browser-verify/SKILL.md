---
name: browser-verify
description: Drive a real Chromium-based browser (Chrome/Edge/Brave) to reproduce a reported UI bug (triage mode) or verify an implementation (tester mode). Produces a video, a Playwright trace, and text artifacts (console/network/page errors, accessibility snapshots) that the agent can read to decide pass/fail. Use when the user asks to verify a UI change, reproduce a UI bug, or produce browser evidence for a PR/issue.
disable-model-invocation: true
---

# browser-verify

Drive a real browser against the user's actual Chrome profile to either **reproduce** a reported bug or **verify** an implementation. Produces text artifacts you read, plus a video and Playwright trace for the human reviewer.

The skill dir is the one containing this file. Below, `<skillDir>` means the directory `SKILL.md` lives in.

## When to use

- **Reproduce** (triage role): a user reports a UI bug; you need to confirm it reproduces before planning a fix.
- **Verify** (tester role): a fix has been implemented; you need browser evidence that the bug is gone and no regressions were introduced.

Do NOT use this skill for unit/integration tests the repo already has. Use it for *end-to-end* evidence from a real browser.

## Steps

1. **One-time bootstrap.** `bash node <skillDir>/scripts/prepare.mjs`. Idempotent; writes a `.prepared` sentinel. First run installs Playwright + downloads ~170 MB Chromium driver. Safe to re-run.

2. **Allocate a run.** `bash node <skillDir>/scripts/new-run.mjs --mode reproduce` (or `--mode verify`). Parse stdout JSON — keep `runId`, `runDir`, `artifactPaths`. Also appends `.harnext/browser-verify/` to `<cwd>/.gitignore`.

3. **Detect the user's browser.** `bash node <skillDir>/scripts/detect-browser.mjs --prefer chrome`. Parse stdout JSON for `executablePath`, `userDataDir`. If exit code is 2 (`no-chromium-browser-found`), STOP and tell the user the skill supports Chrome, Edge, Brave, or Chromium. **Skip in bundled mode** (see step 6).

4. **Resolve profile safely.** `bash node <skillDir>/scripts/profile-lock.mjs --user-data-dir <userDataDir-from-step-3>`. Parse stdout JSON. **Always** use the returned `userDataDir` as the scenario's `USER_DATA_DIR`. If `cloned:true`, the real profile is in use and a minimal copy was placed at `~/.harnext/browser-verify/profile-clone/`. Never pass the raw detected path to the scenario directly. **Skip in bundled mode** (see step 6).

5. **Write the scenario.** `read <skillDir>/templates/verify.template.mjs`. Copy its contents to `<runDir>/scenario.mjs` with `write`. Then `edit` the three `TODO(model):` markers:
   - **STARTING_URL** — replace the `page.goto(...)` target.
   - **REPRO_STEPS** — one `await step('short-label', async () => { ... }, { page, runDir: RUN_DIR })` per user-visible action (click, fill, navigate).
   - **ASSERTIONS** — for any displayed value, use the imported `assertRenderedValue(page, locator, { expected, label, runDir })`. It scrolls the element into view, checks the bbox is inside the viewport, captures `<label>.element.png` and `<label>.fullpage.png`, then string-compares the rendered text. Plain `Locator.isVisible()` is NOT proof of evidence and must not be used as a final assertion.

6. **Execute.** Pick a browser mode and `bash` with the matching env vars:

   **Bundled mode** — preferred for verify against a hermetic local stack. Uses Playwright's bundled Chromium (arm64-native on Apple Silicon, no Rosetta), fresh context per run, no carryover of per-host zoom from a real profile. Skips steps 3–4.
   ```
   SKILL_DIR=<skillDir> \
   RUN_DIR=<runDir> \
   BROWSER_MODE=bundled \
   RUN_ID=<runId> MODE=<mode> \
   HEADLESS=0 TIMEOUT_MS=30000 \
   node <runDir>/scenario.mjs
   ```

   **Persistent mode** — required for reproduce against the user's real profile (cookies/SSO).
   ```
   SKILL_DIR=<skillDir> \
   RUN_DIR=<runDir> \
   USER_DATA_DIR=<from step 4> \
   EXECUTABLE_PATH=<from step 3> \
   RUN_ID=<runId> MODE=<mode> \
   HEADLESS=0 TIMEOUT_MS=30000 \
   node <runDir>/scenario.mjs
   ```
   Exit 0 = passed, exit 1 = failed (failure is normal in reproduce mode — it *confirms* the bug).

7. **Read artifacts.** Always in this order:
   - `read <runDir>/summary.json` — top-level verdict, counts, artifact index.
   - `read <runDir>/steps.jsonl` — each step's outcome + timing.
   - `read <runDir>/asserts.jsonl` — every `assertRenderedValue` call with `expected`, `actual`, `bbox`, `viewport` and the screenshot paths. The PASS/FAIL of the run hinges on these, so cite them.
   - If `counts.pageErrors > 0`: `read <runDir>/page-errors.jsonl`.
   - If `counts.networkErrors > 0`: `read <runDir>/network-errors.jsonl`.
   - For the failing step: `read <runDir>/snapshots/<label>.a11y.txt` — indented text accessibility tree at the moment of failure.

8. **Report to the user.** Concise verdict (pass/fail), cite the specific `asserts.jsonl` and `steps.jsonl` lines that support it (`file:line` format), and the `<label>.element.png` that shows the asserted UI. Point the human to absolute paths of `video/recording.webm` (or `.mp4`) and `trace.zip` (opens in `npx playwright show-trace`). Include `runId` so a later verify run can be diffed against this reproduce.

## Guardrails

- **Never** pass the detected `userDataDir` from step 3 directly to the scenario. Always use the output of `profile-lock.mjs` from step 4 — otherwise you may corrupt the user's real Chrome profile.
- **No secrets** in `scenario.mjs`. The skill redacts `process.env` values ≥ 8 chars from console logs and Cookie/Set-Cookie/Authorization from the HAR, but don't tempt fate.
- **Only navigate to URLs the user named** (or `localhost`/`127.0.0.1`). No exploration of third-party sites.
- **Hard 120s timeout** per scenario. If a step is slow, raise `TIMEOUT_MS` explicitly — don't remove the overall limit.
- **Extensions are disabled** in the launched browser (`--disable-extensions`). If the bug depends on a specific extension, flag that to the user; this skill cannot reproduce it.
- **CI**: `CI=1` forces headless. Persistent-context against a real profile has limited value in CI; warn the user when you detect `CI=1`.
- **Artifacts stay local.** Never commit or upload `.harnext/browser-verify/` contents. The `new-run.mjs` call already gitignores them — keep it that way.
