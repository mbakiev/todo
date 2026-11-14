// Regenerates the raster icons from the SVG sources in build/icon-src/.
//
//   npx electron scripts/generate-icons.mjs
//
// Renders each SVG in an offscreen Electron window (Chromium's SVG renderer, transparent
// background) — no extra dependencies, works on macOS and Windows. Outputs:
//   build/icon.png                      1024×1024 app icon (electron-builder derives .icns/.ico)
//   resources/icon.png                  256×256 window icon (Windows/Linux dev builds)
//   resources/trayTemplate.png, @2x     macOS menu-bar template (16 / 32 px)
//   resources/tray.ico                  Windows tray, PNG-in-ICO at 16/20/24/32/40/48/64 px
//   resources/tray.png                  Linux tray (32 px)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (name) => readFileSync(join(root, 'build/icon-src', name), 'utf8')

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  })
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  await new Promise((r) => setTimeout(r, 150))
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  const { width } = img.getSize()
  if (width !== size) img = img.resize({ width: size, height: size, quality: 'best' })
  win.destroy()
  return img.toPNG()
}

/** ICO container with PNG-encoded entries (supported since Windows Vista). */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

app.disableHardwareAcceleration()
// Windows are created and destroyed one by one; don't quit in between.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const out = (p, buf) => {
    writeFileSync(join(root, p), buf)
    console.log('wrote', p, `${buf.length} bytes`)
  }
  const appIcon = src('app-icon.svg')
  out('build/icon.png', await render(appIcon, 1024))
  out('resources/icon.png', await render(appIcon, 256))

  const template = src('tray-template.svg')
  out('resources/trayTemplate.png', await render(template, 16))
  out('resources/trayTemplate@2x.png', await render(template, 32))

  const color = src('tray-color.svg')
  const sizes = [16, 20, 24, 32, 40, 48, 64]
  const entries = []
  for (const size of sizes) entries.push({ size, png: await render(color, size) })
  out('resources/tray.ico', ico(entries))
  out('resources/tray.png', entries.find((e) => e.size === 32).png)
  app.quit()
})
