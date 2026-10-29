import { execFile } from 'node:child_process'

// The console user's session dictionary carries CGSSessionScreenIsLocked only
// while the screen is locked. Fails closed: if we can't tell, it's locked.
export function isScreenLocked(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('ioreg', ['-n', 'Root', '-d1'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(true)
      resolve(/"CGSSessionScreenIsLocked"=Yes/.test(stdout))
    })
  })
}
