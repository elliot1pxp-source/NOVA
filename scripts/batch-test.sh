#!/usr/bin/env bash
# batch-test.sh — exercise the Files API + Batch API through the configured
# primary endpoint (BASED_URL from .env, i.e. the omniroute tunnel).
#
# Usage:
#   bash scripts/batch-test.sh            # run the full flow
#   bash scripts/batch-test.sh list       # only: GET /files
#   bash scripts/batch-test.sh upload     # only: POST /files
#   bash scripts/batch-test.sh create     # only: POST /batches (needs file_id)
#   bash scripts/batch-test.sh status     # only: GET /batches/<id>
#   bash scripts/batch-test.sh results    # only: fetch batch output file
#
# Env overrides:
#   BASE_URL=...    override the endpoint (default: BASED_URL from .env)
#   NO_BEARER=1     don't send an Authorization header (anonymous)
set -euo pipefail

cd "$(dirname "$0")/.."

# --- resolve endpoint + optional bearer from the URL path key ----------------
BASE_URL="${BASE_URL:-$(grep -E '^BASED_URL=' .env | head -1 | cut -d= -f2-)}"
BASE_URL="${BASE_URL%/}"
if [ -z "$BASE_URL" ]; then
  echo "error: no BASED_URL in .env (and BASE_URL not set)" >&2
  exit 1
fi
echo "endpoint: $BASE_URL"

AUTH=()
if [ -z "${NO_BEARER:-}" ]; then
  KEY="$(printf '%s' "$BASE_URL" | sed -n 's#.*/v1/vscode/\([^/]*\)#\1#p')"
  if [ -n "$KEY" ]; then AUTH=(-H "Authorization: Bearer $KEY"); fi
fi

api() { curl -sS --max-time 30 "${AUTH[@]}" "$@"; }

# --- step 1: list files ------------------------------------------------------
step_list() {
  echo "== GET /files =="
  api "$BASE_URL/files" | jq .
}

# --- step 2: upload a batch input file ---------------------------------------
step_upload() {
  local tmp; tmp="$(mktemp --suffix=.jsonl)"
  trap 'rm -f "$tmp"' RETURN
  cat > "$tmp" <<'EOF'
{"custom_id":"req-1","method":"POST","url":"/v1/chat/completions","body":{"model":"oc/big-pickle","messages":[{"role":"user","content":"Say hi in one sentence"}],"max_tokens":10}}
{"custom_id":"req-2","method":"POST","url":"/v1/chat/completions","body":{"model":"oc/big-pickle","messages":[{"role":"user","content":"What is 2+2? Answer in one word"}],"max_tokens":10}}
EOF
  echo "== POST /files (purpose=batch) =="
  api -X POST "$BASE_URL/files" -F "purpose=batch" -F "file=@$tmp;filename=batch-input.jsonl;type=application/jsonl" | tee /tmp/nova-batch-upload.json | jq .
  echo
  echo "file_id: $(jq -r '.id' /tmp/nova-batch-upload.json 2>/dev/null)"
}

# --- step 3: create a batch --------------------------------------------------
step_create() {
  local fid="${1:-}"
  if [ -z "$fid" ]; then
    echo "error: pass a file_id, e.g. bash scripts/batch-test.sh create file-abc123" >&2
    exit 1
  fi
  echo "== POST /batches =="
  api -X POST "$BASE_URL/batches" \
    -H "Content-Type: application/json" \
    -d "{\"input_file_id\":\"$fid\",\"endpoint\":\"/v1/chat/completions\",\"completion_window\":\"24h\"}" \
    | tee /tmp/nova-batch-create.json | jq .
  echo
  echo "batch_id: $(jq -r '.id' /tmp/nova-batch-create.json 2>/dev/null)"
}

# --- step 4: batch status ----------------------------------------------------
step_status() {
  local bid="${1:-}"
  if [ -z "$bid" ]; then
    echo "error: pass a batch_id, e.g. bash scripts/batch-test.sh status batch_abc123" >&2
    exit 1
  fi
  echo "== GET /batches/$bid =="
  api "$BASE_URL/batches/$bid" | tee /tmp/nova-batch-status.json | jq .
}

# --- step 5: fetch batch results ---------------------------------------------
step_results() {
  local bid="${1:-}"
  if [ -z "$bid" ]; then
    echo "error: pass a batch_id, e.g. bash scripts/batch-test.sh results batch_abc123" >&2
    exit 1
  fi
  echo "== GET /batches/$bid (for output_file_id) =="
  api "$BASE_URL/batches/$bid" | tee /tmp/nova-batch-status.json | jq .
  local out; out="$(jq -r '.output_file_id // empty' /tmp/nova-batch-status.json)"
  if [ -z "$out" ]; then
    echo "batch not completed yet — no output_file_id" >&2
    exit 1
  fi
  echo "output_file_id: $out"
  echo "== GET /files/$out/content =="
  api "$BASE_URL/files/$out/content"
  echo
}

# --- dispatch ----------------------------------------------------------------
case "${1:-full}" in
  list)    step_list ;;
  upload)  step_upload ;;
  create)  step_create "${2:-}" ;;
  status)  step_status "${2:-}" ;;
  results) step_results "${2:-}" ;;
  full)
    step_list
    step_upload
    local fid; fid="$(jq -r '.id' /tmp/nova-batch-upload.json 2>/dev/null || true)"
    if [ -n "$fid" ] && [ "$fid" != "null" ]; then
      step_create "$fid"
    fi
    ;;
  *) echo "usage: $0 [full|list|upload|create|status|results] [id]" >&2; exit 1 ;;
esac
