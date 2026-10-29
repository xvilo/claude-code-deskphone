import { DAEMON_URL } from '../shared/config.ts'
import { findClaudePid } from '../shared/pid.ts'

// Must stay under the hook timeout in hooks.json: ringing, the question and
// the answer all happen while the prompt waits on screen.
const ASK_TIMEOUT_MS = 170_000

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

try {
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const res = await fetch(`${DAEMON_URL}/permission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid: findClaudePid(), tool_name: input.tool_name, tool_input: input.tool_input }),
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  })
  const { decision } = res.ok ? await res.json() : { decision: null }
  if (decision === 'allow' || decision === 'deny') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied over the phone.' },
        },
      }),
    )
  }
} catch {
  // No output leaves the prompt on screen, which is always the safe fallback.
}
