import { phrases } from './phrases.ts'

const MAX_CHARS = Number(process.env.DESKPHONE_MAX_SPEECH_CHARS ?? 900)

export function toSpeech(markdown: string, maxChars = MAX_CHARS, lang = 'en'): string {
  const say = phrases(lang)
  let text = markdown
    .replace(/```[\s\S]*?```/g, ` ${say.codeOnScreen} `)
    .replace(/`([^`]+)`/g, (_, code: string) => (code.length > 30 || /[\\/]/.test(code) ? shortenPath(code) : code))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/([^\s/)]+)[^\s)]*/g, (_, host: string) => say.linkTo(host))
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(\S[\s\S]*?\S|\S)\1/g, '$2')
    .replace(/(?:^|\s)(?:\.{0,2}\/)?(?:[\w.-]+\/)+([\w.-]+)(?::\d+)?/g, (_, file: string) => ` ${file}`)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars)
    const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'))
    text = (sentenceEnd > maxChars / 2 ? cut.slice(0, sentenceEnd + 1) : cut) + ` ${say.restOnScreen}`
  }
  return text
}

// Code and URLs are mostly English, which would pull language detection that way.
export function proseOf(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g, ' ')
}

function shortenPath(code: string): string {
  const parts = code.replace(/:\d+(?::\d+)?$/, '').split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : code
}
