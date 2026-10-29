---
title: Home
nav_order: 1
description: Talk to Claude Code from an analog desk phone. Dial a session, speak a prompt, and get called back with the spoken answer.
permalink: /
---

# Deskphone for Claude Code

Talk to [Claude Code](https://claude.com/claude-code) from a real, corded desk phone.

- Run `/deskphone:phone` in a session and it gets an extension (101, 102, …).
- Pick up the phone, dial that extension and speak. Your words arrive in the session as a prompt.
- When Claude finishes, the phone rings. It reads the answer aloud, beeps, and listens. Your reply becomes the next prompt, or stay silent and it hangs up.
- When Claude needs permission for a tool, the phone rings and reads the request. Say yes or no.
- Missed the call? The reply goes to voicemail and the phone plays a stutter dial tone. Dial `100#` to hear every waiting reply.
- Dial a session with nothing waiting and it reads Claude Code's own `※ recap` of where that session is.

```
analog phone ──RJ11── ATA (Grandstream HT801) ──Ethernet── USB-C adapter ── Mac
                                                                     │ Internet Sharing NAT
            Asterisk (Docker on the Mac, or public on Kubernetes) ───┤ SIP + RTP
                                                                     │ ARI + media WebSockets (Mac → Asterisk)
                                                                     ├─ deskphone daemon: whisper.cpp, macOS `say`
                                                                     └─ Claude Code + deskphone plugin
                                                                          ├─ channel MCP server: speech in as prompts
                                                                          └─ Stop hook: rings the phone with the reply
```

## What you need

| | |
| --- | --- |
| **Mac** | macOS with Homebrew. Speech uses `say` and Internet Sharing, so the daemon is macOS-only. |
| **Node.js** | 23.6 or newer (runs the TypeScript directly). |
| **Claude Code** | A version with channels (a research preview; built against 2.1.312). On Team/Enterprise plans an admin must allow channels. |
| **Phone hardware** | Any analog (pulse/DTMF) phone, an ATA with an FXS port, and a USB Ethernet adapter. See [Hardware](hardware). |
| **Asterisk** | Docker Desktop on the Mac, or a Kubernetes cluster you can expose to the internet. See [Asterisk](asterisk). |

## Setup at a glance

1. [Get the hardware](hardware): an ATA and a USB Ethernet adapter.
2. [Install the software](installation): clone, run `scripts/setup.sh`.
3. [Run Asterisk](asterisk): locally in Docker, or publicly on Kubernetes.
4. [Connect and configure the ATA](phone).
5. [Make your first call](usage).

When something doesn't work, check [Troubleshooting](troubleshooting). [How it works](how-it-works) explains the moving parts.
