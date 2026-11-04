#!/usr/bin/env bash
# 推广长图字体子集：从 lib/cn-referral-poster.ts 的 POSTER_TEXT 取字，生成 Noto Sans CJK SC 子集（SIL OFL 1.1）
# 依赖：fonttools（pyftsubset），系统 Noto Sans CJK ttc（fonts-noto-cjk）；SC 在 ttc 内 index 2
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=${NOTO_CJK_DIR:-/usr/share/fonts/opentype/noto}
OUT=public/fonts/poster
mkdir -p "$OUT"
python3 - > /tmp/poster-chars.txt <<'PY'
import re
s = open('lib/cn-referral-poster.ts', encoding='utf8').read()
m = re.search(r"export const POSTER_TEXT = \{(.*?)\n\};", s, re.S).group(1)
chars = set(''.join(re.findall(r"'([^']*)'", m))) | set("0123456789①②③④→·／ ") | {chr(i) for i in range(32, 127)}
print(''.join(sorted(chars)))
PY
for w in Regular Bold; do
  pyftsubset "$SRC/NotoSansCJK-$w.ttc" --font-number=2 --text-file=/tmp/poster-chars.txt \
    --output-file="$OUT/NotoSansSC-Poster-$w.otf" --layout-features='*' --no-hinting --name-IDs='*'
done
ls -la "$OUT"
