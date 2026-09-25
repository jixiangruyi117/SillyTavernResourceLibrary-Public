/** A short data URL keeps a unique origin without putting large APPs/vendor bundles in a URL. */
export const OPAQUE_PREVIEW_DOCUMENT_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><meta charset="utf-8"><script>
window.addEventListener('message',function receive(event){
  if(event.source!==parent||event.data?.type!=='srl:preview-document'||typeof event.data.html!=='string')return;
  window.removeEventListener('message',receive);
  document.open();document.write(event.data.html);document.close();
});
</script>`)

const initialized = new WeakSet<HTMLIFrameElement>()

/** First load seeds the opaque document; its subsequent load is the real APP/preview load. */
export function seedOpaquePreviewDocument(frame: HTMLIFrameElement, html: string): boolean {
  if (initialized.has(frame)) return false
  initialized.add(frame)
  frame.contentWindow?.postMessage({ type: 'srl:preview-document', html }, '*')
  return true
}
