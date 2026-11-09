#!/bin/sh
# This chain only admits the existing TURN/WireGuard relay to Meet8 RTC ports.
set -eu
rule() { iptables -w 5 "$@"; }
reconcile() {
  rule -N MEET8-MEDIA 2>/dev/null || true
  rule -C MEET8-MEDIA -p tcp --dport 7981 -j ACCEPT 2>/dev/null || rule -A MEET8-MEDIA -p tcp --dport 7981 -j ACCEPT
  rule -C MEET8-MEDIA -p udp --dport 51100:51200 -j ACCEPT 2>/dev/null || rule -A MEET8-MEDIA -p udp --dport 51100:51200 -j ACCEPT
  first=$(rule -L DOCKER-USER --line-numbers -n | awk '$1 == "1" {print $2; exit}')
  if [ "$first" != MEET8-MEDIA ]; then
    while rule -C DOCKER-USER -i wg-desk8 -s 10.66.0.1/32 -d 10.255.254.100/32 -j MEET8-MEDIA 2>/dev/null; do
      rule -D DOCKER-USER -i wg-desk8 -s 10.66.0.1/32 -d 10.255.254.100/32 -j MEET8-MEDIA
    done
    rule -I DOCKER-USER 1 -i wg-desk8 -s 10.66.0.1/32 -d 10.255.254.100/32 -j MEET8-MEDIA
  fi
}
while true; do
  if ! reconcile; then echo 'Meet8 media firewall reconciliation failed; retrying.' >&2; fi
  sleep 5
done
