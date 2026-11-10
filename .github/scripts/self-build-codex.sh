#!/usr/bin/env bash
# Usage: self-build-codex.sh <prompt-file>
# Runs Codex as the owner's ChatGPT account. Codex refreshes the login, so it is saved back to the
# environment secret after every call and kept on disk for the next call in the same job.
set -uo pipefail

prompt="$1"
export CODEX_HOME="$RUNNER_TEMP/codex-home"

if [[ ! -f "$CODEX_HOME/auth.json" ]]; then
  command -v codex >/dev/null || npm install -g @openai/codex@0.167.0 >/dev/null || exit 1
  mkdir -p "$CODEX_HOME" && chmod 700 "$CODEX_HOME"
  printf 'cli_auth_credentials_store = "file"\n' > "$CODEX_HOME/config.toml"
  base64 --decode <<<"$CODEX_AUTH_JSON" > "$CODEX_HOME/auth.json" || exit 1
  chmod 600 "$CODEX_HOME/auth.json"
fi

mask_login() {
  for token in $(jq -r '.tokens | .access_token, .refresh_token, .id_token' "$CODEX_HOME/auth.json"); do
    echo "::add-mask::$token"
  done
}

save_login() {
  local encoded
  if ! jq -e '.tokens.refresh_token and .tokens.access_token and .tokens.id_token' "$CODEX_HOME/auth.json" >/dev/null 2>&1 ||
     ! encoded="$(base64 < "$CODEX_HOME/auth.json" | tr -d '\n')" || [[ -z "$encoded" ]]; then
    echo "::error::Codex login file is missing or incomplete; not saving it" >&2
    return 1
  fi
  for _ in 1 2 3; do
    if printf '%s' "$encoded" | gh secret set CODEX_AUTH_JSON --env codex --repo "$GITHUB_REPOSITORY"; then
      return 0
    fi
    sleep 5
  done
  echo "::error::Could not save the refreshed Codex login; reseed CODEX_AUTH_JSON" >&2
  return 1
}

mask_login
# The transcript stays off the public log; only the final message is shown, after masking any refreshed tokens.
codex_status=0
codex exec --model "$CODEX_MODEL" -c model_reasoning_effort=high --sandbox workspace-write \
  --ephemeral --output-last-message "$RUNNER_TEMP/codex-summary.md" - \
  < "$prompt" >> "$RUNNER_TEMP/codex-transcript.log" 2>&1 || codex_status=$?
mask_login
cat "$RUNNER_TEMP/codex-summary.md" 2>/dev/null || true
echo
save_login || exit 1
if (( codex_status != 0 )); then
  echo "::error::codex exec failed with status $codex_status" >&2
  exit "$codex_status"
fi
