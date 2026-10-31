#!/bin/bash
# Copy Caddy's Let's Encrypt cert for rich-smart.com.cn into mosquitto; restart broker only if changed.
set -euo pipefail
SRC=/var/lib/docker/volumes/aliyun_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/rich-smart.com.cn
DST=/opt/caomi-mqtt/certs
[ -s "$SRC/rich-smart.com.cn.crt" ] && [ -s "$SRC/rich-smart.com.cn.key" ] || { echo "$(date -Is) source cert missing" >&2; exit 1; }
openssl x509 -in "$SRC/rich-smart.com.cn.crt" -noout -checkend 0 >/dev/null || { echo "$(date -Is) source cert expired, skip" >&2; exit 1; }
if cmp -s "$SRC/rich-smart.com.cn.crt" "$DST/fullchain.pem" && cmp -s "$SRC/rich-smart.com.cn.key" "$DST/privkey.pem"; then exit 0; fi
install -m 0644 -o 1883 -g 1883 "$SRC/rich-smart.com.cn.crt" "$DST/fullchain.pem"
install -m 0600 -o 1883 -g 1883 "$SRC/rich-smart.com.cn.key" "$DST/privkey.pem"
echo "$(date -Is) cert updated: $(openssl x509 -in $DST/fullchain.pem -noout -enddate)"
if docker ps --format '{{.Names}}' | grep -qx caomi-mqtt; then docker restart caomi-mqtt >/dev/null && echo "$(date -Is) caomi-mqtt restarted"; fi
