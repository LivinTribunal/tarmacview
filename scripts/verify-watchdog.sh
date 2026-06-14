#!/usr/bin/env bash
# anti-hang watchdog for harnext-verify.
#
# why this exists: the claude-code-action bun wrapper hangs after the
# Anthropic SDK reports success because leftover children (mempalace MCP,
# chrome-devtools-mcp, playwright chromium) inherit the action's stdio
# pipes and never close them. bun waits on EOF that never arrives. the
# claude step then sits idle until the 90-min job timeout, blocking
# every later verify in the queue.
#
# the existing post-claude cleanup step (harnext-verify.yml) is too late
# - it can only run after the claude step exits, and the claude step is
# what's hung. this watchdog runs in parallel with the claude step, polls
# the run-stub comment until claude PATCHes it with the final report
# (claude's last action, per the prompt's section 5), waits a short grace
# period, and force-kills the orphan children. that closes the stdio
# pipes bun is waiting on, so bun exits and the claude step returns
# promptly.
#
# scope: only PIDs spawned during this run, by pattern. uses the same
# pre/post snapshot diff as the post-claude cleanup so it never touches
# MCP / browser children of the operator's interactive claude sessions
# running on the same self-hosted mac.
#
# env required:
#   REPO            - github repo (owner/name)
#   GH_TOKEN        - token for `gh api`
# env optional:
#   PRE_PIDS              - pre-claude pid snapshot (default /tmp/verify/pre.pids)
#   COMMENT_ID_FILE       - file with stub comment id (default /tmp/verify/comment-id.txt)
#   WATCHDOG_LOG          - log path (default /tmp/verify/watchdog.log)
#   GRACE_SECONDS         - wait after finalization before kill (default 60)
#   POLL_INTERVAL         - comment poll cadence (default 30)
#   MAX_WAIT_SECONDS      - cap on total wait before giving up (default 4200 = 70min)

set -uo pipefail

: "${REPO:?REPO required}"
: "${GH_TOKEN:?GH_TOKEN required}"

PRE="${PRE_PIDS:-/tmp/verify/pre.pids}"
COMMENT_ID_FILE="${COMMENT_ID_FILE:-/tmp/verify/comment-id.txt}"
LOG="${WATCHDOG_LOG:-/tmp/verify/watchdog.log}"
GRACE_SECONDS="${GRACE_SECONDS:-60}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-4200}"

mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

ts()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*"; }

log "watchdog started; pid=$$ repo=$REPO grace=${GRACE_SECONDS}s poll=${POLL_INTERVAL}s max=${MAX_WAIT_SECONDS}s"

start=$(date +%s)
elapsed() { echo $(($(date +%s) - start)); }

# wait for claude's stub comment to appear
COMMENT_ID=""
while [ -z "$COMMENT_ID" ]; do
  if [ -s "$COMMENT_ID_FILE" ]; then
    COMMENT_ID=$(tr -d '[:space:]' < "$COMMENT_ID_FILE")
    [ -n "$COMMENT_ID" ] && break
  fi
  if [ "$(elapsed)" -gt "$MAX_WAIT_SECONDS" ]; then
    log "timed out waiting for $COMMENT_ID_FILE; exiting"
    exit 0
  fi
  sleep 5
done
log "tracking comment $COMMENT_ID"

# poll until the stub is replaced with the final report
while true; do
  body=$(gh api "repos/$REPO/issues/comments/$COMMENT_ID" --jq .body 2>/dev/null || echo "")
  # stub format from the prompt: "verify running… run `<run-id>`"
  if [ -n "$body" ] && ! printf '%s' "$body" | head -1 | grep -qE '^verify running…'; then
    log "comment finalized after $(elapsed)s; body length=${#body}"
    break
  fi
  if [ "$(elapsed)" -gt "$MAX_WAIT_SECONDS" ]; then
    log "max wait reached ($(elapsed)s); exiting without kill"
    exit 0
  fi
  sleep "$POLL_INTERVAL"
done

# grace period - claude may push a commit or run a final gh call after
# patching the comment. don't yank chromium out from under that.
log "grace ${GRACE_SECONDS}s before killing orphans"
sleep "$GRACE_SECONDS"

if [ ! -f "$PRE" ]; then
  log "no pre-snapshot at $PRE - cannot diff safely; exiting"
  exit 0
fi

POST=/tmp/verify/post.pids.watchdog
SPAWNED=/tmp/verify/spawned.pids.watchdog
: > "$POST"
for pat in 'mempalace.mcp_server' 'chrome-devtools-mcp' '@modelcontextprotocol/server-puppeteer' '\.cache/ms-playwright/.*chromium' 'playwright.*chromium'; do
  pgrep -f "$pat" >> "$POST" || true
done
sort -u "$POST" -o "$POST"
comm -13 "$PRE" "$POST" > "$SPAWNED"

if [ -s "$SPAWNED" ]; then
  log "killing pids spawned during this run:"
  xargs ps -o pid,command -p < "$SPAWNED" || true
  xargs kill -TERM < "$SPAWNED" || true
  sleep 5
  xargs kill -KILL < "$SPAWNED" 2>/dev/null || true
  log "kill complete"
else
  log "no spawned PIDs to kill"
fi
