---
title: Configuration
nav_order: 7
---

# Configuration

## Daemon (`.env`)

`npm run daemon` reads `.env` in the repo root.

| Variable | Default | |
| --- | --- | --- |
| `DESKPHONE_ARI_URL` | `http://127.0.0.1:8088/ari` | Comma-separated ARI base URLs, tried in order. The daemon holds the first that answers and starts over from the top if it drops. |
| `DESKPHONE_ARI_USER` | `deskphone` | |
| `DESKPHONE_ARI_PASSWORD` | `deskphone` | Must match `ARI_PASSWORD` in `asterisk/.env`. |
| `DESKPHONE_ENDPOINT` | `PJSIP/phone` | What callbacks dial. |
| `DESKPHONE_VOICE` | system voice | `say -v` voice name. |
| `DESKPHONE_LANGUAGE` | `auto` | Whisper language (`en`, `nl`, …). Fixing it is faster and more accurate than `auto`. |
| `DESKPHONE_WHISPER_MODEL` | `models/ggml-small.bin` | |
| `DESKPHONE_WHISPER_BIN` | `whisper-cli` | |
| `DESKPHONE_RING_SECONDS` | `30` | How long a callback rings before going to voicemail. |
| `DESKPHONE_REPLY_WAIT_MS` | `8000` | Silence after the beep on a callback before it hangs up. |
| `DESKPHONE_VAD_THRESHOLD` | `500` | Speech level (RMS of 16-bit samples). Lower it if quiet speech isn't picked up. |
| `DESKPHONE_MAX_SPEECH_CHARS` | `900` | Longer replies are cut, with "the rest is on screen". |
| `DESKPHONE_PIN_FILE` | `~/.config/deskphone/pin` | Where `npm run set-pin` stores the PIN hash. |
| `DESKPHONE_PORT` | `7788` | Local control API, bound to `127.0.0.1`. |

The plugin's channel server and Stop hook find the daemon at `DESKPHONE_URL` (default `http://127.0.0.1:7788`).

## Asterisk (`asterisk/.env`)

| Variable | |
| --- | --- |
| `PHONE_PASSWORD` | SIP password of the `phone` account, which the ATA uses. |
| `ARI_PASSWORD` | Password of the `deskphone` ARI user, which the daemon uses. |

`EXTERNAL_IP` (the address or hostname advertised to phones) and `SIP_PORT` are set in `docker-compose.yml` and `kubernetes/deployment.yaml`.

## Extensions

| Dial | |
| --- | --- |
| `101#`–`199#` | A Claude session, in the order sessions register. A session asks for its previous extension back after a daemon restart. |
| `100#` | Voicemail for all sessions. |
