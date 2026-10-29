// Sets the PIN the phone asks for while this Mac is locked.
import { stdin, stdout } from 'node:process'
import { PIN_FILE, isValidPin, savePin } from '../src/daemon/pin.ts'

function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    let input = ''
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          return resolve(input)
        }
        if (char === '\u0003') process.exit(130)
        if (char === '\u007f') input = input.slice(0, -1)
        else input += char
      }
    }
    stdin.on('data', onData)
  })
}

const pin = await ask('New PIN (4-8 digits): ')
if (!isValidPin(pin)) {
  console.error('A PIN is 4 to 8 digits.')
  process.exit(1)
}
if ((await ask('Repeat PIN: ')) !== pin) {
  console.error("PINs don't match.")
  process.exit(1)
}
await savePin(pin)
console.log(`Saved to ${PIN_FILE}. The phone asks for it while this Mac is locked.`)
