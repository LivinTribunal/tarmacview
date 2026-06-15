---
name: dropbox-upload
description: Upload a single local file (e.g. a browser-verify proof video, MP4, screenshot, or any artifact) to Dropbox and get back a public share link. Use when you need to attach a viewable artifact to a GitHub PR/issue comment instead of citing a local path, or when the user asks to upload a file to Dropbox or get a shareable link for a local file.
---

# dropbox-upload

Upload one local file to Dropbox and print its **public share URL** to stdout. Built for the verify stage: browser-verify produces proof videos and screenshots on the self-hosted runner, but their local paths (`~/harnext-artifacts/...`) are meaningless to anyone reading the PR on GitHub. This turns that artifact into a link anyone can open.

The skill dir is the one containing this file. Below, `<skillDir>` means that directory.

## When to use

- The verify stage has a proof video / element screenshot and wants the PR comment to cite a **clickable link**, not a runner-local path.
- The user asks to upload a local file to Dropbox or get a shareable link for it.

## What it does

`upload-dropbox.js <file>` uploads the file under `DROPBOX_UPLOAD_PATH` (default `/verify-proofs`) with a random 6-hex filename, creates a public share link, and prints **only the URL** to stdout (all chatter goes to stderr, so `URL=$(...)` works).

## Usage

```bash
# one-time: mint a long-lived refresh token (opens a browser to approve)
node <skillDir>/upload-dropbox.js --auth

# upload, capture the public link
URL=$(node <skillDir>/upload-dropbox.js /path/to/proof.mp4)

# override remote filename / preview without calling the API
node <skillDir>/upload-dropbox.js proof.mp4 --name run-1234.mp4
node <skillDir>/upload-dropbox.js proof.mp4 --dry-run
```

## Credentials

Self-contained (Node >= 18, no npm deps). Reads `DROPBOX_*` from the environment first, then falls back to a gitignored `<skillDir>/.env`. See `.env.example` for the full ~2-minute Dropbox app setup. Two auth flavours:

- **Long-lived (recommended, what CI uses):** `DROPBOX_APP_KEY` + `DROPBOX_APP_SECRET`, then run `--auth` once to write `DROPBOX_REFRESH_TOKEN`. The app's **Settings -> OAuth 2 -> Redirect URIs** must include `http://localhost:49234` for `--auth` to complete.
- **Short-lived:** paste a `DROPBOX_ACCESS_TOKEN` from the app console (~4 h; useless for unattended CI).

## CI usage (verify stage)

The verify workflow passes `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` / `DROPBOX_REFRESH_TOKEN` from GitHub Actions secrets as env into the claude step. Because env wins over `.env`, no `.env` file is needed on the runner. The upload is **best-effort**: if the script exits non-zero (missing creds, network), fall back to citing the local artifact path and do NOT fail the stage.
