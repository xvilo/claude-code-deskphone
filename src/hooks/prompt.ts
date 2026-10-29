import { DAEMON_URL } from '../shared/config.ts'
import { PHONE_STYLE } from '../shared/phone-style.ts'
import { findClaudePid } from '../shared/pid.ts'

try {
  const res = await fetch(`${DAEMON_URL}/status`, { signal: AbortSignal.timeout(1000) })
  const { sessions } = (await res.json()) as { sessions: { pid: number }[] }
  const pid = findClaudePid()
  if (sessions.some(s => s.pid === pid)) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `This session is phone-enabled. ${PHONE_STYLE}` } }),
    )
  }
} catch {
  // Daemon down: the session isn't on the phone, so there is nothing to add.
}
