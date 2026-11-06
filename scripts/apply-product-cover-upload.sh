#!/bin/sh
# Patch only the product cover upload fix onto an existing server tree.
# Stops when the two page files are not the known pre-patch bytes.
# Does not read .env, does not upload a product, does not restart Docker.
set -eu

ROOT="${2:-/opt/caomi-cn}"
MODE="${1:-check}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATCH="${COVER_PATCH:-$SCRIPT_DIR/../deploy/product-cover-upload-20261106.patch}"
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP="${COVER_BACKUP:-/opt/caomi-cn-backups/product-cover-$STAMP}"

hash_of() { sha256sum "$1" | awk '{print $1}'; }

NEW_BEFORE=12be82aa382b82adc27e3920d288ea8353ba1eae72991ea85b222c57ff7a5d9d
NEW_AFTER=70b2b3cc7818c7e31679c5d38bed4bdf68edaaa44ed935a46f4edb1f7bb4aa29
EDIT_BEFORE=692468673a0f4fb6153d1c9431e50d520ef06c5ee9ff6a0c38b6de1f38460ac8
EDIT_AFTER=cc7bcfc4dc1189a8041ff6a15de5c49153c91c00404bbd4f9c0a3f8005041b82
LIB_AFTER=034e366de275f85cba553a302f8a61232b87c03d7aa33847be71eb38b5bd4f0c
LIB_REL=lib/brand-asset-public-url.ts

mark_page() {
  got="$1"; before="$2"; after="$3"
  if [ "$got" = "$before" ]; then printf before
  elif [ "$got" = "$after" ]; then printf after
  else printf mismatch
  fi
}

printf 'root %s\n' "$ROOT"
if [ -f "$ROOT/.next/BUILD_ID" ]; then printf 'BUILD_ID %s\n' "$(cat "$ROOT/.next/BUILD_ID")"; fi
if [ -d "$ROOT/.git" ]; then printf 'git %s\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"; fi

new_path="$ROOT/app/vendor/products/new/page.tsx"
edit_path="$ROOT/app/vendor/products/[id]/edit/page.tsx"
lib_path="$ROOT/$LIB_REL"
if [ ! -f "$new_path" ] || [ ! -f "$edit_path" ]; then
  echo 'STOP product page missing. Do not copy this repository over the server.'
  exit 2
fi
new_got=$(hash_of "$new_path")
edit_got=$(hash_of "$edit_path")
new_mark=$(mark_page "$new_got" "$NEW_BEFORE" "$NEW_AFTER")
edit_mark=$(mark_page "$edit_got" "$EDIT_BEFORE" "$EDIT_AFTER")
printf '%s %s app/vendor/products/new/page.tsx\n' "$new_mark" "$new_got"
printf '%s %s app/vendor/products/[id]/edit/page.tsx\n' "$edit_mark" "$edit_got"

if [ -f "$lib_path" ]; then
  lib_got=$(hash_of "$lib_path")
  if [ "$lib_got" = "$LIB_AFTER" ]; then lib_mark=after; else lib_mark=mismatch; fi
  printf '%s %s %s\n' "$lib_mark" "$lib_got" "$LIB_REL"
else
  lib_mark=absent
  printf 'absent - %s\n' "$LIB_REL"
fi

state=mismatch
if [ "$new_mark" = before ] && [ "$edit_mark" = before ] && [ "$lib_mark" = absent ]; then
  state=before
elif [ "$new_mark" = after ] && [ "$edit_mark" = after ] && [ "$lib_mark" = after ]; then
  state=after
fi

case "$state" in
  before) echo 'CHECK ok: pages match origin/main 0d3784226510acef1eb132354caed1c56fcaa2ef and the helper file is absent. Other files were not compared.' ;;
  after) echo 'CHECK ok: product cover upload fix is already in these three files.' ;;
  *)
    echo 'STOP these files do not match the known base or the fix. Do not reset or rsync this repo onto the server.'
    echo 'If the server copies differ, send read-only sha256 of the two page files. Do not paste .env.'
    exit 2
    ;;
esac

if [ "$MODE" = check ]; then exit 0; fi
if [ "$MODE" != apply ]; then echo 'usage: apply-product-cover-upload.sh check|apply [root]' >&2; exit 64; fi
if [ "$state" = after ]; then echo 'already applied; no write'; exit 0; fi
if [ ! -f "$PATCH" ]; then echo "STOP patch not found: $PATCH" >&2; exit 2; fi

mkdir -p "$BACKUP"
cp -p "$new_path" "$BACKUP/new-page.tsx"
cp -p "$edit_path" "$BACKUP/edit-page.tsx"
if [ -f "$ROOT/.next/BUILD_ID" ]; then cp -p "$ROOT/.next/BUILD_ID" "$BACKUP/BUILD_ID"; fi
echo "backup $BACKUP"

restore() {
  cp -p "$BACKUP/new-page.tsx" "$new_path"
  cp -p "$BACKUP/edit-page.tsx" "$edit_path"
  rm -f "$lib_path"
}

if ! (cd "$ROOT" && patch -p1 --forward --batch < "$PATCH"); then
  echo 'STOP patch failed; restoring'
  restore
  exit 2
fi

if [ "$(hash_of "$new_path")" != "$NEW_AFTER" ] || [ "$(hash_of "$edit_path")" != "$EDIT_AFTER" ] || [ "$(hash_of "$lib_path")" != "$LIB_AFTER" ]; then
  echo 'STOP hash mismatch after patch; restoring'
  restore
  exit 2
fi

echo 'SOURCE PATCHED. Image is not rebuilt and the site is not restarted. No product was submitted.'
echo 'Build from THIS server tree, not a fresh GitHub checkout:'
echo "  cd $ROOT && npm run build"
echo 'Then tag the current image and recreate only the web container:'
echo "  docker tag caomi-cn-web:latest caomi-cn-web:rollback-product-cover-$STAMP"
echo "  docker compose -f $ROOT/deploy/aliyun/docker-compose.yml up -d --no-deps caomi-web"
echo 'Do not copy .env.aliyun, data volumes, Caddy, or any other source file.'
