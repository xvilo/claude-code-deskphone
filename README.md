# Deskphone for Claude Code

Call your [Claude Code](https://claude.com/claude-code) sessions from a real analog desk phone. Dial a session's extension and speak a prompt. When Claude finishes, the phone rings and reads the answer aloud, and you can reply right away.

**Documentation: <https://xvilo.github.io/claude-code-deskphone/>**

- Each session gets an extension (`/deskphone:phone`), and you dial `101#` to talk to it.
- Your speech is transcribed locally with whisper.cpp and arrives in the session as a prompt.
- When the turn ends, Claude calls back and reads its reply with macOS text-to-speech.
- Answer Claude's multiple-choice questions by saying "do 1 and 3" or pressing the digits.
- While your Mac is locked, a PIN is needed before the phone accepts input.
- Press any key to cut Claude short and go straight to the beep.
- Permission prompts ring the phone too: say yes or no.
- Missed calls go to voicemail, signalled by a stutter dial tone. Dial `100#` to hear them, or press 2 there for a list of your sessions.
- Dial a session with nothing waiting and it reads Claude Code's `※ recap`.

```
analog phone ──RJ11── ATA (Grandstream HT801) ──Ethernet── USB-C adapter ── Mac
                                                                     │ Internet Sharing NAT
            Asterisk (Docker on the Mac, or public on Kubernetes) ───┤ SIP + RTP
                                                                     │ ARI + media WebSockets (Mac → Asterisk)
                                                                     ├─ deskphone daemon: whisper.cpp, macOS `say`
                                                                     └─ Claude Code + deskphone plugin
```

## Quick start

You need a Mac with Homebrew, Node.js 23.6+, Claude Code with channels (research preview), an analog phone, an ATA with an FXS port (for example a Grandstream HT801 v2), and a USB Ethernet adapter.

```sh
git clone https://github.com/xvilo/claude-code-deskphone.git
cd claude-code-deskphone
scripts/setup.sh                                  # whisper.cpp, ffmpeg, model, plugin
cp .env.example .env
cp asterisk/.env.example asterisk/.env            # set PHONE_PASSWORD and ARI_PASSWORD
(cd asterisk && docker compose up -d)             # or deploy to Kubernetes: kubectl apply -k asterisk/
npm run daemon                                    # keep running
scripts/claude-phone                              # then /deskphone:phone in the session
```

Then connect the ATA through macOS Internet Sharing and register it as `phone`. The full walkthrough, including the gotchas, is in the docs:

1. [Hardware](https://xvilo.github.io/claude-code-deskphone/hardware)
2. [Installation](https://xvilo.github.io/claude-code-deskphone/installation)
3. [Asterisk](https://xvilo.github.io/claude-code-deskphone/asterisk): local Docker, or public on Kubernetes
4. [Phone setup](https://xvilo.github.io/claude-code-deskphone/phone): Internet Sharing and HT801 settings
5. [Usage](https://xvilo.github.io/claude-code-deskphone/usage)
6. [Configuration](https://xvilo.github.io/claude-code-deskphone/configuration), [Troubleshooting](https://xvilo.github.io/claude-code-deskphone/troubleshooting), [How it works](https://xvilo.github.io/claude-code-deskphone/how-it-works)

## Development

```sh
npm test
npm run fake-call -- 101   # a call to ext 101 without a phone
```

The docs site is the `docs/` folder, published with GitHub Pages.

## License

MIT. Not affiliated with Anthropic.
