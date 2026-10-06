import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.srlapp': 'application/octet-stream',
}

export async function startAuditPreview({ directory, nextDirectory, port, run, apiFixture }) {
  let root = await realpath(directory)
  const nextRoot = nextDirectory ? await realpath(nextDirectory) : undefined
  let networkUnavailable = false
  const server = createServer(async (request, response) => {
    if (networkUnavailable) {
      request.socket.destroy()
      return
    }
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      // Reproduce the existing Worker relaunch endpoint for upgrade audits only.
      if (apiFixture && nextRoot && path === '/api/relaunch' && request.method === 'GET') {
        const html = await readFile(resolve(root, 'index.html'), 'utf8')
        response
          .writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-SRL-Audit-Run': run,
          })
          .end(html.replace('</head>', '<script>history.replaceState(null,"","/")</script></head>'))
        return
      }
      if (apiFixture && path.startsWith('/api/')) {
        if (!['GET', 'POST'].includes(request.method)) {
          response.writeHead(405).end()
          return
        }
        const fixture = apiFixture(path)
        response
          .writeHead(fixture.status || 200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-SRL-Audit-Run': run,
          })
          .end(JSON.stringify(fixture.json))
        return
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end()
        return
      }
      const file = await realpath(resolve(root, '.' + (path === '/' ? '/index.html' : path)))
      const inside = relative(root, file)
      if (inside.startsWith('..' + sep) || inside === '..' || resolve(root, inside) !== file)
        throw new Error('outside preview root')
      const info = await stat(file)
      if (!info.isFile()) throw new Error('not a file')
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-SRL-Audit-Run': run,
      })
      if (request.method === 'HEAD') response.end()
      else
        createReadStream(file)
          .on('error', () => response.destroy())
          .pipe(response)
    } catch {
      // Missing catalog/assets must not silently become the SPA index page.
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
    }
  })
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', accept)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    activateNext: () => {
      if (!nextRoot) throw new Error('未指定下一版本候选')
      root = nextRoot
    },
    setNetworkUnavailable: (value) => {
      networkUnavailable = value
      if (value) server.closeAllConnections()
    },
    close: () =>
      new Promise((accept, reject) => {
        server.close((error) => (error ? reject(error) : accept()))
        server.closeAllConnections()
      }),
  }
}
