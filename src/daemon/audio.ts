export const SAMPLE_RATE = 8000
// slin at 8 kHz in 20 ms frames, which is what Asterisk sends and expects.
export const FRAME_BYTES = 320

export function tone(freq = 880, ms = 180, amplitude = 6000): Buffer {
  const samples = Math.floor((SAMPLE_RATE * ms) / 1000)
  const pcm = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)), i * 2)
  }
  return pcm
}
