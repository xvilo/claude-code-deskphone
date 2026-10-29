import { DAEMON_URL } from '../shared/config.ts'
import { findClaudePid } from '../shared/pid.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

try {
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const text = input.last_assistant_message
  if (typeof text === 'string' && text.trim()) {
    await fetch(`${DAEMON_URL}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: findClaudePid(), text, transcript: input.transcript_path }),
      signal: AbortSignal.timeout(3000),
    })
  }
} catch {
  // Daemon down or session not phone-enabled: the hook must never disturb the session.
}
