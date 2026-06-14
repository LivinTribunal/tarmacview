#!/usr/bin/env bash
# append a failure section to the verify run's existing in-place comment.
#
# the verify agent writes `/tmp/verify/comment-id.txt` at the start of its run.
# this helper reads that, fetches the current body, and PATCHes a new section
# onto it — keeping the "single in-place comment" contract intact.
#
# usage: scripts/verify-comment-append.sh <gate-name> <stderr-file>
#
# env required: GH_TOKEN, REPO

set -euo pipefail

GATE="${1:-}"
ERR_FILE="${2:-}"

if [ -z "$GATE" ] || [ -z "$ERR_FILE" ]; then
  echo "usage: $0 <gate-name> <stderr-file>" >&2
  exit 2
fi

COMMENT_ID=$(cat /tmp/verify/comment-id.txt 2>/dev/null || true)
if [ -z "$COMMENT_ID" ]; then
  echo "no /tmp/verify/comment-id.txt — agent did not record the comment id; surfacing failure to job log only" >&2
  [ -f "$ERR_FILE" ] && cat "$ERR_FILE" >&2
  exit 0
fi

EXISTING=$(gh api "repos/$REPO/issues/comments/$COMMENT_ID" --jq .body 2>/dev/null || true)

{
  if [ -n "$EXISTING" ]; then
    printf '%s\n\n---\n\n' "$EXISTING"
  fi
  printf '## verify gate failed: %s\n\n' "$GATE"
  printf '```\n'
  [ -f "$ERR_FILE" ] && cat "$ERR_FILE" || printf '(no stderr captured)\n'
  printf '```\n'
} > /tmp/verify/comment-new.md

gh api -X PATCH "repos/$REPO/issues/comments/$COMMENT_ID" \
  --field body=@/tmp/verify/comment-new.md >/dev/null
echo "appended '$GATE' failure to comment $COMMENT_ID"
