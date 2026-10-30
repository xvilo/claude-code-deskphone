import { MENU_EXT, type Range, type Ranges } from './mode.ts'

export type Dialed =
  | { kind: 'menu' }
  | { kind: 'session'; ext: number }
  | { kind: 'phone'; number: number }
  | { kind: 'unknown' }

const within = (n: number, range: Range) => n >= range.first && n <= range.last

export function classify(dialed: string, ranges: Ranges): Dialed {
  if (!/^[1-9]\d*$/.test(dialed)) return { kind: 'unknown' }
  const n = Number(dialed)
  if (n === MENU_EXT) return { kind: 'menu' }
  if (within(n, ranges.sessions)) return { kind: 'session', ext: n }
  if (within(n, ranges.phones)) return { kind: 'phone', number: n }
  return { kind: 'unknown' }
}
