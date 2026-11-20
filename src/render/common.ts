// ============================================================================
// Canvas commons: camera transforms, grid, hit helpers.
// ============================================================================

export interface Camera {
  x: number
  y: number
  zoom: number
}

export function defaultCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 }
}

export function screenToWorld(cam: Camera, sx: number, sy: number, cw: number, ch: number): { x: number; y: number } {
  return {
    x: (sx - cw / 2) / cam.zoom + cam.x,
    y: (sy - ch / 2) / cam.zoom + cam.y,
  }
}

export function worldToScreen(cam: Camera, wx: number, wy: number, cw: number, ch: number): { x: number; y: number } {
  return {
    x: (wx - cam.x) * cam.zoom + cw / 2,
    y: (wy - cam.y) * cam.zoom + ch / 2,
  }
}

export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera, cw: number, ch: number, dpr = 1) {
  ctx.setTransform(
    cam.zoom * dpr,
    0,
    0,
    cam.zoom * dpr,
    (cw / 2 - cam.x * cam.zoom) * dpr,
    (ch / 2 - cam.y * cam.zoom) * dpr,
  )
}

export function baseTransform(ctx: CanvasRenderingContext2D, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, cw: number, ch: number, step = 20, dpr = 1) {
  const tl = screenToWorld(cam, 0, 0, cw, ch)
  const br = screenToWorld(cam, cw, ch, cw, ch)
  ctx.save()
  baseTransform(ctx, dpr)
  const pass = (spacing: number, color: string) => {
    if (spacing * cam.zoom < 7) return
    const x0 = Math.floor(tl.x / spacing) * spacing
    const y0 = Math.floor(tl.y / spacing) * spacing
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = x0; x <= br.x; x += spacing) {
      const sx = Math.round((x - cam.x) * cam.zoom + cw / 2) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, ch)
    }
    for (let y = y0; y <= br.y; y += spacing) {
      const sy = Math.round((y - cam.y) * cam.zoom + ch / 2) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(cw, sy)
    }
    ctx.stroke()
  }
  pass(step, 'rgba(73,92,98,0.09)')
  pass(step * 5, 'rgba(73,92,98,0.16)')
  ctx.restore()
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function snap(v: number, step = 20): number {
  return Math.round(v / step) * step
}

/** Fit a camera to a world-space bounding box. */
export function fitCameraToBounds(
  cam: Camera,
  cw: number,
  ch: number,
  bounds: { x: number; y: number; w: number; h: number },
  pad = 120,
) {
  const bw = Math.max(200, bounds.w + pad * 2)
  const bh = Math.max(200, bounds.h + pad * 2)
  cam.zoom = Math.max(0.15, Math.min(2.5, Math.min(cw / bw, ch / bh)))
  cam.x = bounds.x + bounds.w / 2
  cam.y = bounds.y + bounds.h / 2
}
