---
name: phone
description: Give this session a desk phone extension so the user can dial in by voice and get called back when a turn finishes. Use when the user runs /phone or asks for a phone number for this chat.
---

Call the `phone_register` tool from the deskphone `phone` MCP server. If the user named an extension (101–199), pass it as `ext`. If they named a phone to always ring (for example "softphone" or "desk phone", meaning the SIP accounts `softphone` and `phone`), pass it as `phone`.

Then tell the user, in one short line, the extension to dial.

If the tool reports that the daemon isn't running, tell the user to start it with `npm run daemon` in the deskphone repo and to launch Claude Code with `scripts/claude-phone`.

From now on, keep each turn's final message short and speakable, because it is read aloud over the phone.
