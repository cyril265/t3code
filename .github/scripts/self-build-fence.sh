#!/usr/bin/env bash
# Usage: self-build-fence.sh <allowed-paths-file>
# Fails if the working tree changes a path outside the allowed list or under .github/.
set -euo pipefail

changed="$( { git diff --name-only --no-renames HEAD; git ls-files --others --exclude-standard; } | sort -u)"
outside="$(comm -23 <(printf '%s\n' "$changed") <(sort -u "$1"))"
workflow="$(printf '%s\n' "$changed" | grep '^\.github/' || true)"
blocked="$(printf '%s\n%s\n' "$outside" "$workflow" | sed '/^$/d' | sort -u)"
if [[ -n "$blocked" ]]; then
  echo "::error::Codex changed files it may not touch: $(tr '\n' ' ' <<<"$blocked")" >&2
  exit 1
fi
