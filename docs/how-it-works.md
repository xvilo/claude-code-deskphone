---
title: How it works
nav_order: 9
---

# How it works

## Pieces

| Piece | Where | Role |
| --- | --- | --- |
| ATA | next to the phone | Turns the analog line into SIP and RTP. |
| Asterisk | Docker on the Mac, or Kubernetes | SIP registrar and media bridge, driven entirely over ARI by the `deskphone` Stasis app. |
| Daemon (`src/daemon`) | Mac | Holds the ARI connection, speech in and out, extensions, voicemail. HTTP control API on `127.0.0.1:7788`. |
| Channel MCP server (`src/channel`) | one per Claude session | Registers the session with the daemon and pushes transcribed speech into it as `notifications/claude/channel`. Exposes `phone_register`, `phone_unregister` and `phone_status`. |
| Stop hook (`src/hooks/stop.ts`) | one per turn | Async. Posts `last_assistant_message` and the transcript path to the daemon, which rings the phone. |

The channel server and the Stop hook both walk up the process tree to the owning `claude` process. Its PID links them to the same session in the daemon.

## A call

1. **Inbound:** the dialplan sends `1XX` to `Stasis(deskphone,inbound,<ext>)`.
2. The daemon answers, creates a WebSocket media channel with `connection_type=server`, and connects to `/media/<id>` itself. It then bridges that channel with the caller in a mixing bridge.
3. Audio flows as raw 8 kHz signed-linear frames, 320 bytes per 20 ms. The daemon paces playback against the wall clock.
4. Text to speech: `say` to AIFF, then ffmpeg band-passes it to 300–3400 Hz and resamples it to 8 kHz.
5. Speech to text: an energy-based endpointer (1.5 s of trailing silence) collects the speech, ffmpeg resamples it to 16 kHz, and `whisper-cli` transcribes it.
6. **Outbound:** ARI originates `PJSIP/phone` into the same Stasis app. Once you answer, media is attached the same way.

Because every connection goes from the Mac to Asterisk, Asterisk never needs to reach the Mac.

## Voicemail and message waiting

Unanswered replies queue per session in the daemon. The Asterisk image has no `res_mwi_external`, so to light the stutter tone the daemon originates `Local/<count>@deskphone-mwi`. That dialplan sends a `message-summary` NOTIFY to the phone's registered contact with `PJSIPNotify`.

## Recap

Claude Code stores its `※ recap` line in the session transcript as a `system` entry with subtype `away_summary`. When you dial a session, the daemon reads the newest one from the transcript the Stop hook reported, and reads the last reply instead if the recap is older. This relies on an internal transcript format and may break with Claude Code updates.

## Development

```sh
npm test                                           # unit tests
curl -XPOST localhost:7788/register -d '{"pid":1,"cwd":"/tmp/test"}'
curl -N 'localhost:7788/events?pid=1' &            # watch prompts arrive
npm run fake-call -- 101                           # a call without a phone
```

Node runs the TypeScript directly through type stripping. That means no enums, no parameter properties, and imports end in `.ts`.
