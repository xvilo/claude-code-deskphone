---
name: phone
description: Give this session a desk phone extension so the user can dial in by voice and get called back when a turn finishes. Use when the user runs /phone or asks for a phone number for this chat.
---

Call the `phone_register` tool from the deskphone `phone` MCP server. If the user named a session extension (101–199), pass it as `ext`. If they named a phone to always ring, pass it as `phone`: either its account name (for example "softphone"; the desk phone is `phone`) or its number (four digits from 1001; the desk phone is 1001), so `/phone 1004` pins callbacks to the phone numbered 1004. `phone_device_list` shows the names and numbers. If the number is outside both ranges, ask which one they meant instead of guessing.

Then tell the user, in one short line, the extension to dial.

If the tool reports that the daemon isn't running, tell the user to start it with `npm run daemon` in the deskphone repo and to launch Claude Code with `scripts/claude-phone`.

From now on, keep each turn's final message short and speakable, because it is read aloud over the phone.
