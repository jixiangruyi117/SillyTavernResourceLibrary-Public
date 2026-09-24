/**
 * Web Share Target 接收器（由 sw.js importScripts 引入）。
 *
 * 系统分享面板把文件 POST 到 /share-target；这里把文件暂存进
 * Cache Storage 后 303 跳回应用首页，应用完成登录后取走并进入
 * 常规导入管线。文件只短暂驻留本机缓存，被取走时立即删除，
 * 不发送到任何服务器。
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData()
        const files = formData.getAll('files').filter((item) => typeof item !== 'string')
        if (files.length) {
          const intakeId =
            self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
          const prefix = `/srl-shared/${intakeId}`
          const cache = await caches.open('srl-share-intake')
          const manifest = []
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index]
            manifest.push({ name: file.name || `shared-${index}`, type: file.type || '' })
            await cache.put(
              `${prefix}/${index}`,
              new Response(file, {
                headers: { 'content-type': file.type || 'application/octet-stream' },
              }),
            )
          }
          await cache.put(
            `${prefix}/manifest`,
            new Response(JSON.stringify({ intakeId, createdAt: Date.now(), files: manifest }), {
              headers: { 'content-type': 'application/json' },
            }),
          )
          return Response.redirect(`/?share-target=${encodeURIComponent(intakeId)}`, 303)
        }
      } catch (error) {
        // 解析失败时仍跳回应用；应用侧会提示没有收到文件。
        console.warn('[SRL share-target]', error)
      }
      return Response.redirect('/?share-target=received', 303)
    })(),
  )
})
