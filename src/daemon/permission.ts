import { basename } from 'node:path'
import { toSpeech } from './speech-text.ts'

export type Decision = 'allow' | 'deny' | null

const MAX_DETAIL_CHARS = 160

function short(text: unknown): string {
  const speech = toSpeech(String(text ?? ''), MAX_DETAIL_CHARS)
  return speech.replace(/ The rest is on screen\.$/, '')
}

function file(input: Record<string, unknown>): string {
  return basename(String(input.file_path ?? input.notebook_path ?? input.path ?? 'a file'))
}

// Short and speakable: the details are on screen.
export function describePermission(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Bash':
      return `run a command: ${short(input.description || input.command)}`
    case 'Read':
      return `read ${file(input)}`
    case 'Edit':
    case 'MultiEdit':
      return `edit ${file(input)}`
    case 'Write':
      return `write ${file(input)}`
    case 'NotebookEdit':
      return `edit the notebook ${file(input)}`
    case 'WebFetch':
      return `fetch ${short(String(input.url ?? '').replace(/^https?:\/\//, '').split('/')[0])}`
    case 'WebSearch':
      return `search the web for ${short(input.query)}`
    default:
      return `use ${tool.replace(/^mcp__/, '').replaceAll('__', ' ').replaceAll('_', ' ')}`
  }
}

const DENY = /\b(no|nope|nah|deny|denied|don't|do not|stop|cancel|nee)\b/
const ALLOW = /\b(yes|yeah|yep|yup|allow|allowed|approve|approved|okay|ok|sure|go ahead|do it|ja)\b/

// "No" wins, so "no, don't allow that" is a denial.
export function parseDecision(transcript: string): Decision {
  const text = transcript.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ')
  if (DENY.test(text)) return 'deny'
  if (ALLOW.test(text)) return 'allow'
  return null
}
