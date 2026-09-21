/** Font Awesome repeats the same embedded font across several compatibility faces.
 * Keep each font once in the document and create its URL inside the isolated frame.
 * The URLs belong to that document and are released by the browser when it unloads.
 */
export function buildPreviewFontStylesheet(css: string | undefined): string {
  if (!css) return ''
  const fonts: string[] = []
  const indices = new Map<string, number>()
  const compact = css.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/gu, (font) => {
    let index = indices.get(font)
    if (index === undefined) {
      index = fonts.length
      indices.set(font, index)
      fonts.push(font.slice(font.indexOf(',') + 1))
    }
    return `__SRL_PREVIEW_FONT_${index}__`
  })
  if (!fonts.length) return `<style>${css}</style>`
  const literal = (value: unknown) => JSON.stringify(value).replace(/</gu, '\\u003c')
  return `<script>(()=>{const fonts=${literal(fonts)};let css=${literal(compact)};for(let i=0;i<fonts.length;i++){const bytes=Uint8Array.from(atob(fonts[i]),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'font/woff2'}));css=css.replaceAll('__SRL_PREVIEW_FONT_'+i+'__',url)}const style=document.createElement('style');style.textContent=css;document.head.append(style)})()</script>`
}
