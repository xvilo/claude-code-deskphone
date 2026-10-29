---
title: Troubleshooting
nav_order: 8
---

# Troubleshooting

Start with the daemon's log and `curl localhost:7788/status`.

### `no Asterisk reachable, retrying`

The daemon can't open the ARI WebSocket. Check `curl -u deskphone:<ARI_PASSWORD> <DESKPHONE_ARI_URL>/asterisk/info`. A full-tunnel VPN doesn't matter for the public setup. For a private address, the VPN may be capturing the route; prefer a public hostname over juggling VPN routes.

### Busy tone right after dialing

`Stasis()` fell through, so the daemon isn't connected to the Asterisk the phone is registered with. Check the log for `connected to Asterisk at …`.

### "There is no Claude session on extension …"

No session has registered that extension. Run `/deskphone:phone` in the session, and check it was started with `scripts/claude-phone`.

### The call connects but there's no audio either way

Asterisk advertised an address the phone can't reach. Typical causes:
- With a hostname in `EXTERNAL_IP`, Asterisk started before the DNS record existed, so it advertised the pod IP. Restart Asterisk.
- `local_net` was added to `pjsip.conf` and matches the phone's (SNATed) source address. Leave it out.
- The RTP ports (`10000–10019/udp`) aren't forwarded, or a firewall blocks them.

Look for `heard nothing: 0 audio frames` in the daemon log. A capture on the Mac shows where the ATA sends its audio:

```sh
sudo tcpdump -ni bridge100 'udp and host 192.168.2.2 and not port 53'
```

### You hear Claude, but it never hears you

`heard nothing: 0 audio frames` means no RTP from the phone reached Asterisk. See above. A non-zero frame count with a low peak means the speech is too quiet: lower `DESKPHONE_VAD_THRESHOLD`.

### Callback never rings, or `Allocation failed`

The phone isn't registered. Check **Status → Port Status** on the ATA, or `pjsip show contacts` in Asterisk. After a network change, it re-registers within its 2-minute expiry.

### The ATA reports IP `0.0.0.0`

See [Phone setup](phone#2-find-the-atas-ip-address): Internet Sharing is going to the wrong adapter, NAT64 is on, or the ATA is on a static IP.

### Prompts don't show up in the session

`ext … heard (session not connected, queued)` means the session's channel server isn't connected to the daemon. It reconnects every few seconds and then gets the queued prompt. If it never does, the session wasn't started with the channel flag (`scripts/claude-phone`).

### Test without a phone

```sh
npm run fake-call -- 101
```

This creates a call to 101 inside Asterisk that sends a short tone. The log should show the inbound call and a non-zero frame count.
