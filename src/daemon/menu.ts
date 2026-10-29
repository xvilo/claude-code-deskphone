// Spoken text for the keypad menu on the voicemail extension. English only,
// like the other menu prompts.

import { basename } from 'node:path'
import { phrases } from './phrases.ts'
import type { Session } from './registry.ts'

export function describeSessions(sessions: Session[]): string {
  if (!sessions.length) return 'No Claude sessions are registered.'
  const intro = sessions.length === 1 ? 'One session.' : `${sessions.length} sessions.`
  const each = sessions.map(s => `${phrases('en').extension(s.ext, basename(s.cwd))}, ${s.listener ? 'connected' : 'not connected'}, ${waiting(s.voicemail.length)}.`)
  return [intro, ...each].join(' ')
}

function waiting(count: number): string {
  if (!count) return 'no messages'
  return count === 1 ? 'one message waiting' : `${count} messages waiting`
}
