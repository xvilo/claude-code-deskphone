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

Press any key (for example `*` or `0`) while Claude is talking to cut it short and jump straight to the beep. This works for greetings, recaps, callbacks, permission questions and voicemail. While `100#` plays messages, a keypress skips to the reply beep for the current message, and the next message plays after that.

The ATA must send keypresses as RFC 2833 / RFC 4733 events, the HT801's default ("DTMF via RFC2833").

## Callbacks

When a phone-enabled session finishes a turn, the phone rings.

- **Answer:** Claude reads its reply (markdown, code blocks and long paths are stripped, and very long replies are cut off with "the rest is on screen", or "de rest staat op het scherm" for a Dutch reply). After the beep, speak your next prompt, or stay silent and it hangs up.
- **Don't answer:** the reply goes to voicemail.

Callbacks ring the phone you last dialed from, so with a desk phone and a softphone the reply comes back to where you are. Before your first call after a daemon restart, they ring `DESKPHONE_ENDPOINT`. To always ring one device for a session, name it when you set it up, for example `/deskphone:phone softphone` or "give this chat a phone number on the desk phone". To add phones, see [More phones](phone#more-phones).

Callbacks wait until the line is free. If Claude answers while you're still on the call that asked the question, the phone rings right after you hang up.

## Permission prompts

When Claude needs your permission for a tool call, the phone rings. You hear something like "Extension 101, customer-frontend, needs permission to read StripeV3Add.js. Say yes to allow, or no to deny." After the beep:

- **"Yes"** (or "yeah", "go ahead", "allow", "ja") approves this one call.
- **"No"** (or "deny", "stop", "nee") denies it, and Claude is told it was denied over the phone. "No" wins when both appear.
- **Anything else, silence, or no answer** leaves the prompt on screen.

Answering the prompt on screen first stops the phone ringing. Only the single request is approved; no permission rules are added.

{: .warning }
Anyone who picks up the phone can approve a request. Turn this off by removing the `PermissionRequest` hook from `hooks/hooks.json` if that's a concern.

## Questions from Claude

When Claude asks a multiple-choice question (the dialog with numbered options), the phone rings and reads the question and its options: "1: Adyen load race. 2: Major npm upgrades. …". After the beep:

- **Single choice:** say "one", "do 2" or "option three", or press the digit on the keypad.
- **Multiple choice:** say "do 1 and 3" or "all of them", or press the digits and then `#`.
- **Your own answer:** say anything without a number and it's sent as a free-text answer, like typing in "Type something".
- **"Never mind", silence, or no answer** leaves the dialog on screen.

Several questions in one dialog are asked one after another. The dialog is answered only if every question gets an answer.

## Locked Mac and PIN

While this Mac's screen is locked, the phone asks for a PIN before it takes any input: before you can speak a prompt, approve a permission or answer a question. Greetings, recaps, callbacks and voicemail still play without it.

Set the PIN once per Mac:

```sh
npm run set-pin    # 4 to 8 digits
```

It's stored as a salted scrypt hash in `~/.config/deskphone/pin`, readable only by you. When asked, type the PIN on the keypad followed by `#`. Typing interrupts the spoken prompt.

- One correct PIN unlocks the rest of that call.
- Three wrong tries end the call. Five wrong PINs in a row, across calls, block PIN entry for 15 minutes.
- Locked with no PIN set, or if the lock state can't be read: nothing is accepted by phone. It fails closed.

## Voicemail

While replies are waiting, lifting the handset gives a **stutter dial tone** instead of the steady one.

- Dial a session's extension to hear that session's waiting replies, then answer it.
- Dial **`100#`** for the menu: "Press 1 for messages, 2 for sessions."
  - Press **1**, or nothing at all, to hear every waiting reply across all sessions, oldest first. Each one is announced with its extension and folder and followed by a beep. Answer it, or stay silent to skip to the next.
  - Press **2** to hear the registered sessions instead, see [Several sessions](#several-sessions).
  - Any other key repeats the menu once.

Voicemail is saved to `~/.config/deskphone/voicemail.json`, so it survives a daemon restart. When a session reconnects, its messages go back to its extension. Messages from a session that doesn't come back can still be heard on `100#`, but there is no beep to answer them.

## Several sessions

Each session that runs `/deskphone:phone` gets its own extension. Callbacks from different sessions queue up, since the phone has one line. Dial `100#` and press **2** to hear the registered sessions: each extension with its folder, whether Claude Code is connected to it, and how many messages it has waiting. `curl localhost:7788/status` shows the same on screen. When a session's Claude Code process exits, the daemon frees its extension within half a minute. Any waiting messages from it stay on `100#`.
