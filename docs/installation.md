---
title: Installation
nav_order: 3
---

# Installation

Everything except Asterisk and the ATA runs on your Mac.

## 1. Clone and run the setup script

```sh
git clone https://github.com/xvilo/claude-code-deskphone.git
cd claude-code-deskphone
scripts/setup.sh
```

`scripts/setup.sh`:
- installs `whisper-cpp` and `ffmpeg` with Homebrew, if missing
- runs `npm install`
- downloads the multilingual whisper `small` model (~470 MB) to `models/`
- registers this clone as a local plugin marketplace and installs the `deskphone` plugin into Claude Code

`WHISPER_MODEL=base scripts/setup.sh` gets a smaller, faster but less accurate model. Then point `DESKPHONE_WHISPER_MODEL` at `models/ggml-base.bin`.

The plugin is installed from your clone rather than straight from GitHub on purpose: its channel server needs the clone's `node_modules`, and the daemon runs from the clone anyway.

## 2. Create the config files

```sh
cp .env.example .env                    # read by the daemon
cp asterisk/.env.example asterisk/.env  # read by Asterisk
```

Generate two passwords and put them in `asterisk/.env`:

```sh
openssl rand -hex 12   # PHONE_PASSWORD: the ATA's SIP password
openssl rand -hex 16   # ARI_PASSWORD: the daemon's Asterisk password
```

Copy `ARI_PASSWORD` into `.env` as `DESKPHONE_ARI_PASSWORD`. You set `DESKPHONE_ARI_URL` in the next step, once you know where Asterisk runs.

## 3. Set a PIN

```sh
npm run set-pin
```

While your Mac is locked, the phone asks for this PIN before it accepts prompts, approvals or answers. See [Usage](usage#locked-mac-and-pin).

## 4. Pick a voice (optional)

The daemon speaks with the macOS **system voice** unless `DESKPHONE_VOICE` is set. `say -v` can't select Siri voices by name, but if you choose a Siri voice under **System Settings → Accessibility → Spoken Content → System voice**, the daemon uses it. You can also download a Premium voice there (for example *Zoe (Premium)*) and set `DESKPHONE_VOICE="Zoe (Premium)"` in `.env`.

Each reply is spoken in its own language. The daemon detects it with macOS's language recognizer. When the reply isn't in `DESKPHONE_VOICE_LANGUAGE` (default `en`), the daemon picks an installed voice for that language. It prefers the home locale (`nl_NL` over `nl_BE`) and Premium or Enhanced voices, so downloading one, for example *Xander (Enhanced)*, is enough. To choose one yourself, set `DESKPHONE_VOICE_NL="Xander (Enhanced)"`. To use a Siri voice for your main language, make it the system voice and set `DESKPHONE_VOICE_LANGUAGE` to that language.

Short replies such as "Ja." or "OK, done." are hard to recognize. When the recognizer isn't sure, the daemon keeps to a language already in play: the session's last clearly detected reply language, then `DESKPHONE_LANGUAGE`, then any language with a `DESKPHONE_VOICE_<LANG>` setting, then `DESKPHONE_VOICE_LANGUAGE`. If you often get short replies in a second language, setting `DESKPHONE_VOICE_<LANG>` for it helps from the first reply on.

The words the daemon adds around a reply follow the reply's language too: "(code on screen)", "a link to …", "the rest is on screen", the "Extension 101" and "Recap" or "Last time" prefixes, and the instructions after a question from Claude. They exist in English and Dutch; other languages get the English wording. Menu prompts such as the PIN and voicemail announcements stay in English.

Next: [run Asterisk](asterisk).
