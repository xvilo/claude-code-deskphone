import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

function parentOf(pid: number): { ppid: number; comm: string } | null {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    const match = out.match(/^(\d+)\s+(.+)$/)
    return match ? { ppid: Number(match[1]), comm: match[2] } : null
  } catch {
    return null
  }
}

// The channel server and the Stop hook are both descendants of the same
// claude process, so its PID is the shared key that links them.
export function findClaudePid(start = process.ppid): number {
  let pid = start
  while (pid > 1) {
    const info = parentOf(pid)
    if (!info) break
    if (basename(info.comm) === 'claude') return pid
    pid = info.ppid
  }
  return process.ppid
}
