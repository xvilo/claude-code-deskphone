---
title: Usage
nav_order: 6
---

# Usage

## Start everything

```sh
npm run daemon          # terminal 1: keep it running
scripts/claude-phone    # terminal 2: Claude Code with the deskphone channel loaded
```

The daemon logs `connected to Asterisk at …` once it holds the ARI connection.

`scripts/claude-phone` runs `claude --dangerously-load-development-channels plugin:deskphone@deskphone-local`, which channels need while they're a research preview. Any other `claude` arguments pass through.

In the session, run `/deskphone:phone`, or ask Claude to "give this chat a phone number". It replies with its extension, starting at 101.

## Calling a session

Lift the handset and dial the extension followed by `#`, for example `101#`.

1. You hear "Claude, extension 101, tags-backend" (the session's folder), followed by a recap of where it is: Claude Code's own `※ recap` if there is a recent one, otherwise its last reply.
2. After the beep, speak. A pause of 1.5 seconds ends your turn.
3. You hear "Got it." The transcript arrives in the session as a prompt.

Speech is transcribed by whisper.cpp, so expect the odd misheard word. Claude is told the text is spoken input and to read it generously.

## Skipping ahead

Press any key (for example `*` or `0`) while Claude is talking to cut it short and jump straight to the beep. This works for greetings, recaps, callbacks, permission questions and voicemail. On `100#`, a keypress skips to the reply beep for the current message, and the next message plays after that.

The ATA must send keypresses as RFC 2833 / RFC 4733 events, the HT801's default ("DTMF via RFC2833").

## Callbacks

When a phone-enabled session finishes a turn, the phone rings.

- **Answer:** Claude reads its reply (markdown, code blocks and long paths are stripped, and very long replies are cut off with "the rest is on screen"). After the beep, speak your next prompt, or stay silent and it hangs up.
- **Don't answer:** the reply goes to voicemail.

Callbacks wait until the line is free. If Claude answers while you're still on the call that asked the question, the phone rings right after you hang up.

## Permission prompts

When Claude needs your permission for a tool call, the phone rings. You hear something like "Extension 101, customer-frontend, needs permission to read StripeV3Add.js. Say yes to allow, or no to deny." After the beep:

- **"Yes"** (or "yeah", "go ahead", "allow", "ja") approves this one call.
- **"No"** (or "deny", "stop", "nee") denies it, and Claude is told it was denied over the phone. "No" wins when both appear.
- **Anything else, silence, or no answer** leaves the prompt on screen.

Answering the prompt on screen first stops the phone ringing. Only the single request is approved; no permission rules are added.

{: .warning }
Anyone who picks up the phone can approve a request. Turn this off by removing the `PermissionRequest` hook from `hooks/hooks.json` if that's a concern.

## Voicemail

While replies are waiting, lifting the handset gives a **stutter dial tone** instead of the steady one.

- Dial a session's extension to hear that session's waiting replies, then answer it.
- Dial **`100#`** to hear every waiting reply across all sessions, oldest first. Each one is announced with its extension and folder and followed by a beep. Answer it, or stay silent to skip to the next.

Voicemail lives in the daemon's memory, so restarting the daemon clears it.

## Several sessions

Each session that runs `/deskphone:phone` gets its own extension. Callbacks from different sessions queue up, since the phone has one line. Run `curl localhost:7788/status` to see the registered sessions and how many messages each has waiting.
