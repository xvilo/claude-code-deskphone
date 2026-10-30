export type Range = { first: number; last: number }
export type Ranges = { sessions: Range; phones: Range }

export const MENU_EXT = 100

export const STANDALONE: Ranges = { sessions: { first: 101, last: 199 }, phones: { first: 1001, last: 1999 } }
export const HOSTED: Ranges = { sessions: { first: 101, last: 9999 }, phones: { first: 10000, last: 99999 } }

export const RANGES: Ranges = STANDALONE
