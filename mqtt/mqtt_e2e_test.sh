#!/bin/bash
# MQTT end-to-end test. Needs mosquitto_pub/mosquitto_sub (2.x) and env:
#   PW_PLATFORM, PW_DEV, HOST (default rich-smart.com.cn), CAFILE (system CA bundle)
HOST=${HOST:-rich-smart.com.cn}
CAFILE=${CAFILE:-/etc/ssl/certs/ca-certificates.crt}
DEV=035743; DU=dev-035743
T=richsmart/dev/$DEV
TLS="-p 8883 --cafile $CAFILE"          # hostname verification is ON by default (no --insecure)
PLAIN="-p 1883"
redact(){ sed -e "s/$PW_PLATFORM/<REDACTED>/g" -e "s/$PW_DEV/<REDACTED>/g"; }
show(){ echo "\$ $*" | redact; }
run(){ show "$@"; "$@" 2>&1 | redact; echo "[exit=${PIPESTATUS[0]}]"; }
bg(){ show "$@ &"; ( "$@" 2>&1 | redact ) & }
MID="t$(date +%s)-$$"
NOW=$(date +%s)

echo "=== 1. TLS 8883: device subscribes cmd, platform publishes start (QoS1) ==="
bg mosquitto_sub -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV -q 1 -t "$T/cmd" -C 1 -W 15 -v
sleep 2
run mosquitto_pub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-test-1 -q 1 -t "$T/cmd" \
  -m "{\"msgId\":\"$MID\",\"ts\":$NOW,\"cmd\":\"start\",\"orderNo\":\"T20261030001\",\"duration\":600,\"gear\":2}"
wait; echo

echo "=== 2. Plain 1883: platform subscribes ack, device publishes ack (QoS1) ==="
bg mosquitto_sub -h $HOST $PLAIN -u platform -P "$PW_PLATFORM" -i platform-test-2 -q 1 -t "richsmart/dev/+/ack" -C 1 -W 15 -v
sleep 2
run mosquitto_pub -h $HOST $PLAIN -u $DU -P "$PW_DEV" -i $DEV -q 1 -t "$T/ack" \
  -m "{\"msgId\":\"$MID\",\"ts\":$NOW,\"cmd\":\"start\",\"code\":0,\"msg\":\"ok\",\"orderNo\":\"T20261030001\",\"remaining\":600}"
wait; echo

echo "=== 2b. TLS: platform subscribes ack, device publishes ack ==="
bg mosquitto_sub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-test-2b -q 1 -t "richsmart/dev/+/ack" -C 1 -W 15 -v
sleep 2
run mosquitto_pub -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV -q 1 -t "$T/ack" -m "{\"msgId\":\"$MID\",\"ts\":$NOW,\"code\":0}"
wait; echo

echo "=== 3. ACL: device $DU publishes to another device's topic (must be denied) ==="
bg mosquitto_sub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-test-3 -q 1 -t "richsmart/dev/999999/#" -C 1 -W 8 -v
sleep 2
run mosquitto_pub -V mqttv5 -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV -q 1 -t "richsmart/dev/999999/cmd" -m '{"cmd":"stop","attack":true}'
wait; echo "(platform subscriber above timed out with no message => publish was dropped by ACL)"; echo
echo "--- device subscribes to another device's cmd topic while platform publishes there (must receive nothing):"
bg mosquitto_sub -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV -q 1 -t "richsmart/dev/999999/#" -C 1 -W 8 -v
sleep 2
run mosquitto_pub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-test-3b -q 1 -t "richsmart/dev/999999/cmd" -m '{"cmd":"query","note":"for 999999 only"}'
wait; echo "(device subscriber timed out => read ACL blocked delivery)"
echo

echo "=== 4. Anonymous & wrong password (must be rejected) ==="
run mosquitto_sub -h $HOST $PLAIN -i anon-test -t "#" -C 1 -W 5
run mosquitto_sub -h $HOST $TLS -i anon-test -t "#" -C 1 -W 5
run mosquitto_sub -h $HOST $PLAIN -u $DU -P wrong-password -i $DEV -t "$T/#" -C 1 -W 5
echo

echo "=== 5. TLS hostname verification negative test (connect by IP, must fail) ==="
run mosquitto_sub -h ${IP_FOR_NEG_TEST:-47.116.127.122} $TLS -u $DU -P "$PW_DEV" -i $DEV -t "$T/cmd" -C 1 -W 5
echo

echo "=== 6. LWT: device connects with retained will on status, then dies ungracefully ==="
show mosquitto_sub -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV -k 5 -t "$T/cmd" --will-topic "$T/status" --will-qos 1 --will-retain --will-payload '{"online":false,"reason":"lwt"}' "&  # then kill -9"
mosquitto_pub -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV-online -q 1 -r -t "$T/status" -m "{\"online\":true,\"ts\":$NOW,\"state\":\"idle\"}" 2>&1 | redact
mosquitto_sub -h $HOST $TLS -u $DU -P "$PW_DEV" -i $DEV -k 5 -t "$T/cmd" --will-topic "$T/status" --will-qos 1 --will-retain --will-payload '{"online":false,"reason":"lwt"}' >/dev/null 2>&1 &
WPID=$!
sleep 2
bg mosquitto_sub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-test-6 -q 1 -t "$T/status" -C 2 -W 25 -F '%I %t %r %p'
sleep 2
echo "\$ kill -9 <device client pid>   # simulate power loss / network drop"; kill -9 $WPID
wait; echo
echo "--- new subscriber afterwards gets the retained offline status:"
run mosquitto_sub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-test-6b -t "$T/status" -C 1 -W 5 -F '%t retained=%r %p'
echo "--- cleanup retained test status"
mosquitto_pub -h $HOST $TLS -u platform -P "$PW_PLATFORM" -i platform-cleanup -r -n -t "$T/status" 2>&1 | redact
echo DONE
