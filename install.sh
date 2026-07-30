#!/usr/bin/env bash
# Overwrite installer - macOS / Linux.
#   curl -fsSL <repo>/install.sh | bash     (or)   ./install.sh
# Creates a Python 3.10-3.13 venv, installs dependencies, and walks you
# through .env setup. Safe to re-run.
set -euo pipefail

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[33m  ! %s\033[0m\n" "$*"; }
die()  { printf "\033[31m  ✗ %s\033[0m\n" "$*"; exit 1; }

bold "Overwrite installer"

# --- 1. find a compatible python (derive_client needs >=3.10,<3.14) ---------
PY=""
for cand in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    ver=$("$cand" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
    major=${ver%%.*}; minor=${ver##*.}
    if [ "$major" -eq 3 ] && [ "$minor" -ge 10 ] && [ "$minor" -le 13 ]; then
      PY="$cand"; ok "using $cand (Python $ver)"; break
    fi
  fi
done
if [ -z "$PY" ]; then
  warn "No compatible Python found. The Derive SDK needs Python 3.10-3.13"
  warn "(3.14+ is TOO NEW, the system 3.9 is too old)."
  die  "Install 3.13 from https://www.python.org/downloads/macos (see 'Stable Releases') and re-run."
fi

# --- 2. venv + dependencies --------------------------------------------------
cd "$(dirname "$0")"
if [ ! -d .venv ] || ! .venv/bin/python -c 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,13)' 2>/dev/null; then
  rm -rf .venv
  "$PY" -m venv .venv
  ok "created .venv"
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
ok "dependencies installed"

# --- 3. .env wizard -----------------------------------------------------------
if [ -f .env ]; then
  ok ".env already exists - leaving it alone"
else
  cp .env.example .env
  bold ""
  bold "Derive credentials (all from testnet.derive.xyz - see docs/RUNBOOK.md §1):"
  printf "  Derive smart-wallet address (0x...): "
  read -r WALLET </dev/tty || WALLET=""
  printf "  Session key PRIVATE key (0x..., trading scope): "
  read -rs SKEY </dev/tty || SKEY=""; echo
  printf "  Subaccount ID (integer, or leave blank to discover later): "
  read -r SUBID </dev/tty || SUBID=""
  {
    echo "DERIVE_WALLET=${WALLET}"
    echo "DERIVE_SESSION_KEY=${SKEY}"
    echo "DERIVE_SUBACCOUNT_ID=${SUBID:-0}"
  } > .env
  ok ".env written (never commit this file)"
  if [ -z "$SUBID" ]; then
    warn "Subaccount ID left blank - discover it with: python3 scripts/diag.py"
  fi
fi

# --- 4. smoke test ------------------------------------------------------------
python3 -m pytest tests/test_greeks.py -q >/dev/null 2>&1 \
  && ok "smoke test passed" \
  || warn "smoke test failed - run 'python3 -m pytest tests/ -q' to investigate"

bold ""
bold "Done. Next steps:"
echo "  source .venv/bin/activate && set -a && source .env && set +a"
echo "  python3 scripts/diag.py                                   # see what the agent sees"
echo "  python3 -m agent.main once --config configs/config.example.yaml    # dry-run"
echo "  # then: set dry_run: false in the YAML and add --live"
