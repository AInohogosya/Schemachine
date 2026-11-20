// ============================================================================
// STL import: parses ASCII and binary STL into welded indexed geometry.
// No dependencies; works in browser and Node.
// ============================================================================

export interface StlGeometry {
  /** xyz per vertex. */
  positions: Float32Array
  /** Triangle indices. */
  indices: Uint32Array
}

function isBinaryStl(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false
  const view = new DataView(buf)
  const triCount = view.getUint32(80, true)
  if (84 + triCount * 50 === buf.byteLength) return true
  // Fallback: check for the 'solid' keyword without erratic bytes early on.
  const head = new Uint8Array(buf.slice(0, 256))
  let text = ''
  for (let i = 0; i < head.length; i++) {
    const c = head[i]
    if (c === 0) return true
    if (c < 9 || (c > 13 && c < 32)) return true
    text += String.fromCharCode(c)
  }
  return !text.trimStart().startsWith('solid')
}

function parseBinary(buf: ArrayBuffer): StlGeometry {
  const view = new DataView(buf)
  const triCount = view.getUint32(80, true)
  const pos: number[] = []
  const idx: number[] = []
  const map = new Map<string, number>()
  const key = (x: number, y: number, z: number): string =>
    `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`
  const vert = (x: number, y: number, z: number): number => {
    const k = key(x, y, z)
    const e = map.get(k)
    if (e !== undefined) return e
    const id = pos.length / 3
    pos.push(x, y, z)
    map.set(k, id)
    return id
  }
  let off = 84
  for (let t = 0; t < triCount; t++) {
    off += 12 // skip normal
    const a = vert(view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true))
    off += 12
    const b = vert(view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true))
    off += 12
    const c = vert(view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true))
    off += 12 + 2 // vertex + attribute bytes
    if (a !== b && b !== c && a !== c) idx.push(a, b, c)
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

function parseAscii(text: string): StlGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const map = new Map<string, number>()
  const key = (x: number, y: number, z: number): string =>
    `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`
  const vert = (x: number, y: number, z: number): number => {
    const k = key(x, y, z)
    const e = map.get(k)
    if (e !== undefined) return e
    const id = pos.length / 3
    pos.push(x, y, z)
    map.set(k, id)
    return id
  }
  const re = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g
  let m: RegExpExecArray | null
  let tri: number[] = []
  while ((m = re.exec(text)) !== null) {
    tri.push(vert(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])))
    if (tri.length === 3) {
      if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) idx.push(tri[0], tri[1], tri[2])
      tri = []
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

export function parseStl(buf: ArrayBuffer): StlGeometry {
  if (isBinaryStl(buf)) return parseBinary(buf)
  const text = new TextDecoder().decode(buf)
  return parseAscii(text)
}

/** Center on origin and scale so the longest side equals targetSize. */
export function normalizeGeometry(geo: StlGeometry, targetSize: number): StlGeometry {
  const p = geo.positions
  if (p.length === 0) return geo
  let x0 = Infinity
  let y0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let z1 = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < x0) x0 = p[i]
    if (p[i] > x1) x1 = p[i]
    if (p[i + 1] < y0) y0 = p[i + 1]
    if (p[i + 1] > y1) y1 = p[i + 1]
    if (p[i + 2] < z0) z0 = p[i + 2]
    if (p[i + 2] > z1) z1 = p[i + 2]
  }
  const size = Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-9)
  const s = targetSize / size
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const cz = (z0 + z1) / 2
  const out = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    out[i] = (p[i] - cx) * s
    out[i + 1] = (p[i + 1] - cy) * s
    out[i + 2] = (p[i + 2] - cz) * s
  }
  return { positions: out, indices: geo.indices }
}

// ---------------------------------------------------------------- base64
function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as unknown as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } }
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64')
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as { Buffer?: { from(s: string, e: string): Uint8Array } }
  if (g.Buffer) return new Uint8Array(g.Buffer.from(b64, 'base64'))
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function f32ToBase64(a: Float32Array): string {
  return bytesToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
}

export function u32ToBase64(a: Uint32Array): string {
  return bytesToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
}

export function base64ToF32(b64: string): Float32Array {
  const b = base64ToBytes(b64)
  const c = new Uint8Array(Math.ceil(b.length / 4) * 4)
  c.set(b)
  return new Float32Array(c.buffer, 0, Math.floor(b.length / 4))
}

export function base64ToU32(b64: string): Uint32Array {
  const b = base64ToBytes(b64)
  const c = new Uint8Array(Math.ceil(b.length / 4) * 4)
  c.set(b)
  return new Uint32Array(c.buffer, 0, Math.floor(b.length / 4))
}
