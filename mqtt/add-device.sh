#!/bin/bash
# Usage: ./add-device.sh <设备编号>        -> creates user dev-<ID>, ACL richsmart/dev/<ID>/#, prints random password once
set -euo pipefail
ID="$1"; [[ "$ID" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "bad id"; exit 1; }
U="dev-$ID"; D=/opt/caomi-mqtt/config
grep -q "^$U:" $D/passwd && { echo "$U already exists"; exit 1; }
PW=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 28)
docker run --rm -v $D:/c -e U="$U" -e P="$PW" --entrypoint sh eclipse-mosquitto:2 -c 'mosquitto_passwd -b /c/passwd "$U" "$P"'
printf '\nuser %s\ntopic readwrite richsmart/dev/%s/#\n' "$U" "$ID" >> $D/acl
chown 1883:1883 $D/passwd $D/acl; chmod 600 $D/passwd $D/acl
docker kill -s HUP caomi-mqtt >/dev/null
echo "created $U  password: $PW"
