---
title: Phone setup
nav_order: 5
---

# Phone setup

The ATA is cabled to the Mac, and the Mac gives it network access with macOS Internet Sharing.

## 1. Share the Mac's connection with the ATA

1. Connect the HT801's **Internet** port to the USB Ethernet adapter, and the phone to its **Phone** port.
2. Open **System Settings → General → Sharing** and click ⓘ next to **Internet Sharing**.
3. **Share your connection from:** the network you're on, usually Wi-Fi.
4. **To devices using:** the adapter the ATA is plugged into, **and only that one**.
5. If the dialog offers **NAT64**, turn it **off**. With it on, the Mac's DHCP server tells clients to prefer IPv6-only, and the HT801 never takes an IPv4 address.
6. Turn Internet Sharing on.

The Mac becomes `192.168.2.1` on that link and hands the ATA an address, usually `192.168.2.2`.

{: .warning }
If two adapters have the same name (for example both "USB 10/100/1G/2.5G LAN"), tick the one the ATA is on. In `ifconfig` it's usually the one linked at 100 Mbit (the HT801 is 10/100), while a dock or office cable runs at 1 Gbit. Sharing onto the wrong one gives the ATA nothing, and your Mac starts handing out DHCP addresses on that other network.

## 2. Find the ATA's IP address

Lift the handset, dial `***`, then `02`. The voice menu reads out its IP address.

- **`192.168.2.x`:** good. Continue.
- **`0.0.0.0`:** it got no address. Check the cable is in the **Internet** port, sharing is onto the right adapter, and NAT64 is off. Then power-cycle the HT801.
- **Anything else** (for example the factory `192.168.0.160`): it's on a static IP. Dial `***`, `01`, press `9` until it says **"Dynamic IP mode"**, hang up and power-cycle it.

## 3. Configure the HT801

Open `https://<ata-ip>` and accept the self-signed certificate. Log in as `admin`: on the HT801 v2 the password is unique per unit and printed on the sticker on the bottom.

Under **Port Settings → FXS Port**:

| Field | Public Kubernetes Asterisk | Local Docker Asterisk |
| --- | --- | --- |
| Primary SIP Server | `your.host.name:15060` | `192.168.2.1` |
| Failover SIP Server | `192.168.2.1` (optional, if you also run Docker) | — |
| Prefer Primary SIP Server | "Will register to Primary Server if Failover registration expires" | — |
| SIP User ID | `phone` | `phone` |
| SIP Authenticate ID | `phone` | `phone` |
| SIP Authentication Password | `PHONE_PASSWORD` from `asterisk/.env` | same |
| NAT Traversal (Network Settings section) | Keep-Alive | Keep-Alive |
| Register Expiration (SIP Settings → Basic) | `2` minutes | `2` minutes |
| Vocoder Preference (Codec Settings) | PCMU first | PCMU first |
| Use # as Dial Key | Yes | Yes |

Click **Save and Apply**. A plain "Save" stores the values without activating them. **Status → Port Status** should then show `phone` as **Registered**.

The short registration expiry matters because the ATA's address changes whenever the Mac changes network. With two minutes, it recovers by itself.

Only one device can be registered per account. A softphone on the laptop (Telephone.app, Linphone) gets its own account, `softphone`, with the password `SOFTPHONE_PASSWORD` from `asterisk/.env`. If both devices use `phone`, they keep pushing each other out and callbacks land on whichever registered last.

## Ringer volume

Most corded phones have a ringer switch on the side or bottom (bell icon, HI / LO / OFF). The ATA has no volume control, but you can shorten callbacks with `DESKPHONE_RING_SECONDS`.

Next: [make your first call](usage).
