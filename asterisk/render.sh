#!/bin/sh
# Fills the ${VAR} placeholders in the mounted configs into /etc/asterisk,
# then hands off to the image's own entrypoint, which fixes ownership and
# drops privileges. sed rather than envsubst, which the image may lack.
set -e
: "${EXTERNAL_IP:?set EXTERNAL_IP to the address or hostname phones reach Asterisk on}"
: "${PHONE_PASSWORD:?set PHONE_PASSWORD}"
: "${ARI_PASSWORD:?set ARI_PASSWORD}"
# Unset leaves the softphone account with a random password nobody knows.
SOFTPHONE_PASSWORD="${SOFTPHONE_PASSWORD:-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')}"
SIP_PORT="${SIP_PORT:-5060}"
for f in /deskphone/*.conf; do
  sed -e "s|\${EXTERNAL_IP}|$EXTERNAL_IP|g" \
      -e "s|\${SIP_PORT}|$SIP_PORT|g" \
      -e "s|\${PHONE_PASSWORD}|$PHONE_PASSWORD|g" \
      -e "s|\${SOFTPHONE_PASSWORD}|$SOFTPHONE_PASSWORD|g" \
      -e "s|\${ARI_PASSWORD}|$ARI_PASSWORD|g" \
      "$f" > "/etc/asterisk/$(basename "$f")"
done
exec /usr/local/bin/entrypoint.sh /usr/sbin/asterisk -vvvf -T -U asterisk -p
