// A visual hint only: runtime, installation state and reader data are never retained here.
// Defaults match the shipped reader.css; ready navigation updates the hint for reentry.
let lastColors: Record<string, string> = {
  paper: '#f6f3ec',
  ink: '#303a32',
  muted: '#85887c',
  line: '#dddfd3',
  accent: '#586c4e',
  soft: '#e8ebdf',
}

export function readChatReaderColors(): Record<string, string> {
  return { ...lastColors }
}

export function rememberChatReaderColors(colors: Record<string, string>): void {
  lastColors = { ...colors }
}

export function chatReaderAppearance(colors: Record<string, string>) {
  return {
    '--reader-paper': colors.paper,
    '--color-canvas': colors.paper,
    '--color-ink': colors.ink,
    '--color-ink-soft': colors.muted,
    '--color-line': colors.line,
    '--color-accent': colors.accent,
    '--color-accent-soft': colors.soft,
  }
}
