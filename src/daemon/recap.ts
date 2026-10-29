import { open } from 'node:fs/promises'

const TAIL_BYTES = 512 * 1024

export type Recap = { text: string; at: number }

// Claude Code's "※ recap" line is stored in the session transcript as a
// system entry with subtype away_summary. This is an internal format, so
// anything unexpected just means no recap.
export async function latestRecap(transcriptPath: string): Promise<Recap | null> {
  try {
    const file = await open(transcriptPath)
    try {
      const { size } = await file.stat()
      const start = Math.max(0, size - TAIL_BYTES)
      const buffer = Buffer.alloc(size - start)
      await file.read(buffer, 0, buffer.length, start)
      return findRecap(buffer.toString('utf8'))
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

export function findRecap(jsonl: string): Recap | null {
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('away_summary')) continue
    try {
      const entry = JSON.parse(lines[i])
      if (entry.type === 'system' && entry.subtype === 'away_summary' && typeof entry.content === 'string') {
        return { text: entry.content, at: Date.parse(entry.timestamp) || 0 }
      }
    } catch {}
  }
  return null
}
