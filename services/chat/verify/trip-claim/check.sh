#!/usr/bin/env bash
# Checks each rule of TripClaim.tla on its own, so one broken rule does not hide another.
# Exits 0 when every result matches the list below; non-zero otherwise.
set -uo pipefail
cd "$(dirname "$0")"

# A rule marked "breaks" would be a known finding listed in the skill; there are none now.
expected=(
  "OneLiveMessagePerRevision  holds"
  "ClaimReleased              holds"
  "LiveComponentsMatchState   holds"
  "NoLostUpdate               holds"
)

status=0
for line in "${expected[@]}"; do
  read -r rule want <<<"$line"
  cfg="$(mktemp -t tripclaim).cfg"
  sed '/^INVARIANTS/,$d' TripClaim.cfg > "$cfg"
  printf 'INVARIANTS\n  TypeOK\n  %s\n' "$rule" >> "$cfg"
  out="$(../tlc.sh "$PWD/TripClaim.tla" -config "$cfg" 2>&1)"
  rm -f "$cfg"
  if grep -q "No error has been found" <<<"$out"; then got=holds
  elif grep -q "Invariant $rule is violated" <<<"$out"; then got=breaks
  else got=error; fi
  if [ "$got" = "$want" ]; then mark=ok; else mark=UNEXPECTED; status=1; fi
  printf '%-26s %-6s (expected %s) %s\n' "$rule" "$got" "$want" "$mark"
  if [ "$got" != holds ]; then
    grep -E "^State [0-9]+:|is violated|^Error" <<<"$out" | sed 's/^/    /'
  fi
done
exit $status
