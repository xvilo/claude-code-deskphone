---
title: Hardware
nav_order: 2
---

# Hardware

An analog phone needs a line that supplies about 48 V and a ringing voltage. A laptop's USB port can't do that, so the cheapest reliable bridge is an **ATA** (analog telephone adapter) with an **FXS** port. It speaks SIP on one side and drives the phone on the other.

| Option | Approx. cost | Notes |
| --- | --- | --- |
| **Grandstream HT801 v2** + USB-C Ethernet adapter | €35–45 + €10–15 | Recommended, and what these docs use. Has its own power supply and plugs straight into the laptop. |
| Cisco/Linksys SPA112 (used) | €15–30 | Two FXS ports. Discontinued but common secondhand. |
| Old FRITZ!Box with an FXS port (7490, 7530, …) | €20–30 used | Works as an ATA if you register it as a SIP client. Fiddlier to set up. |
| DIY: AG1171 SLIC + CM108 USB sound card + RP2040 | ~€20 | Truly USB-only, but needs its own hook and ring driver instead of Asterisk. Not supported here. |

Any corded analog phone works. The project was built with a Profoon TX-155.

**Wiring:** phone → ATA **Phone** port (RJ11). ATA **Internet** port → USB Ethernet adapter → Mac. The whole setup travels with the laptop.

If your Mac already uses a USB or dock Ethernet adapter for its own network, both adapters may show up in macOS with the **same name**. Keep track of which one the ATA is on (see [Phone setup](phone#1-share-the-macs-connection-with-the-ata)).
