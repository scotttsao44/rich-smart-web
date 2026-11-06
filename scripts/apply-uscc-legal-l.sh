#!/bin/sh
# Apply only the USCC legal-L hotfix onto an existing /opt/caomi-cn tree.
# Refuses to run when the four source files are not the known pre-patch bytes.
# Does not read or write .env*, does not touch data volumes, does not docker restart,
# and does not replace the rest of the tree.
set -eu

ROOT="${2:-/opt/caomi-cn}"
MODE="${1:-check}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATCH="${USCC_PATCH:-$SCRIPT_DIR/../deploy/uscc-legal-l-20261106.patch}"
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP="${USCC_BACKUP:-/opt/caomi-cn-backups/uscc-l-$STAMP}"

FILES="
lib/cn-business-license-ocr.ts
lib/local-cn-brand-claim.ts
app/cn/brand/entity/page.tsx
components/BrandClaimAdminPanel.tsx
"

hash_of() {
  sha256sum "$1" | awk '{print $1}'
}

expected_before() {
  case "$1" in
    lib/cn-business-license-ocr.ts) printf '%s\n' a69587069e75ff07ad5d9821efc008eb8cee9b60e758daf4c534b785bc9760ad ;;
    lib/local-cn-brand-claim.ts) printf '%s\n' 73f69a7a9d3d9c457854e14cb836b55963079c97043100571815c57cdddab493 ;;
    app/cn/brand/entity/page.tsx) printf '%s\n' e2fb5bf66688c1722ff09fc155bace9cc0ae8394df755718e0cd2206f686ecdf ;;
    components/BrandClaimAdminPanel.tsx) printf '%s\n' 5cdb9ca2ee344f4f5290f89ed36d4b72d447b987d9d73a2440783b6061e66c2e ;;
    *) return 1 ;;
  esac
}

expected_after() {
  case "$1" in
    lib/cn-business-license-ocr.ts) printf '%s\n' 61018e7fbdb03fa77b597a4cd34572dd5a200fced2af02741d4c54d8562cb867 ;;
    lib/local-cn-brand-claim.ts) printf '%s\n' 48e7d0dffc582a2c9db4eccca9efb5b3442e694c4b54d6a494a9a24682f66acc ;;
    app/cn/brand/entity/page.tsx) printf '%s\n' 72c8021c1d940e620de4ae63fab2d3558675bcc2f117b6a657bc6450cc4aff80 ;;
    components/BrandClaimAdminPanel.tsx) printf '%s\n' 086fcee8fdad056ceac82ff6e27415e625f6f25061ea87b973fdd45b58541684 ;;
    *) return 1 ;;
  esac
}

before_n=0
after_n=0
mismatch_n=0
missing=0
printf 'root %s\n' "$ROOT"
if [ -f "$ROOT/.next/BUILD_ID" ]; then
  printf 'BUILD_ID %s\n' "$(cat "$ROOT/.next/BUILD_ID")"
fi
if [ -d "$ROOT/.git" ]; then
  printf 'git %s\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  git -C "$ROOT" status --short -- "$FILES" || true
fi

for rel in $FILES; do
  path="$ROOT/$rel"
  if [ ! -f "$path" ]; then
    printf 'MISSING %s\n' "$rel"
    missing=1
    mismatch_n=$((mismatch_n + 1))
    continue
  fi
  got=$(hash_of "$path")
  before=$(expected_before "$rel")
  after=$(expected_after "$rel")
  mark=mismatch
  if [ "$got" = "$before" ]; then
    mark=before
  elif [ "$got" = "$after" ]; then
    mark=after
  fi
  printf '%s %s %s\n' "$mark" "$got" "$rel"
  case "$mark" in
    before) before_n=$((before_n + 1)) ;;
    after) after_n=$((after_n + 1)) ;;
    *) mismatch_n=$((mismatch_n + 1)) ;;
  esac
done

state=mismatch
if [ "$missing" -eq 0 ] && [ "$mismatch_n" -eq 0 ] && [ "$before_n" -eq 4 ]; then
  state=before
elif [ "$missing" -eq 0 ] && [ "$mismatch_n" -eq 0 ] && [ "$after_n" -eq 4 ]; then
  state=after
fi

if [ "$missing" -ne 0 ]; then
  echo 'STOP files missing. Do not copy this repository over the server.'
  exit 2
fi

case "$state" in
  before) echo 'CHECK ok: the four files match commit 0d3784226510acef1eb132354caed1c56fcaa2ef. Other files were not compared and must be left as they are.' ;;
  after) echo 'CHECK ok: the four files already match the USCC fix b95e9e723fc929ad61c9906425ea0c0656ff86bc.' ;;
  *)
    echo 'STOP the four files do not match the known base or the fix. Do not reset, checkout, or rsync this repo onto the server.'
    exit 2
    ;;
esac

if [ "$MODE" = check ]; then
  exit 0
fi
if [ "$MODE" != apply ]; then
  echo 'usage: apply-uscc-legal-l.sh check|apply [root]' >&2
  exit 64
fi
if [ "$state" = after ]; then
  echo 'already applied; no write'
  exit 0
fi
if [ ! -f "$PATCH" ]; then
  echo "STOP patch not found: $PATCH" >&2
  exit 2
fi

mkdir -p "$BACKUP"
for rel in $FILES; do
  mkdir -p "$BACKUP/$(dirname "$rel")"
  cp -p "$ROOT/$rel" "$BACKUP/$rel"
done
if [ -f "$ROOT/.next/BUILD_ID" ]; then
  cp -p "$ROOT/.next/BUILD_ID" "$BACKUP/BUILD_ID"
fi
echo "backup $BACKUP"

if ! (cd "$ROOT" && patch -p1 --forward --batch < "$PATCH"); then
  echo 'STOP patch failed; restoring the four files'
  for rel in $FILES; do cp -p "$BACKUP/$rel" "$ROOT/$rel"; done
  exit 2
fi

for rel in $FILES; do
  got=$(hash_of "$ROOT/$rel")
  after=$(expected_after "$rel")
  if [ "$got" != "$after" ]; then
    echo "STOP hash mismatch after patch: $rel"
    for rel2 in $FILES; do cp -p "$BACKUP/$rel2" "$ROOT/$rel2"; done
    exit 2
  fi
done

echo 'SOURCE PATCHED. Image is not rebuilt and the site is not restarted.'
echo 'Next, on a machine with Node, build from THIS server tree (not a fresh GitHub checkout):'
echo '  cd '"$ROOT"' && npm run build'
echo 'Then back up .next, tag the current image, and recreate only the web container:'
echo '  docker tag caomi-cn-web:latest caomi-cn-web:rollback-uscc-l-'"$STAMP"
echo '  # compose service name in this project is caomi-web; confirm with docker compose config --services'
echo '  docker compose -f '"$ROOT"'/deploy/aliyun/docker-compose.yml up -d --no-deps caomi-web'
echo 'Do not copy .env.aliyun, data volumes, Caddy, or any other source file.'
