// ============================================================================
// Displacement brush math (dependency-free): dent/bulge stamps applied to
// plain position/normal arrays in mesh-local space. Deterministic — the
// same op list always rebuilds the same shape (save/load, physics).
// ============================================================================

import type { DisplaceOp } from '../types'

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** Apply a single stamp; returns the number of vertices moved. */
export function applyDisplaceOp(data: MeshData, op: DisplaceOp): number {
  const { positions, normals } = data
  const r2 = op.radius * op.radius
  if (!(r2 > 0)) return 0
  let moved = 0
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - op.x
    const dy = positions[i + 1] - op.y
    const dz = positions[i + 2] - op.z
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r2) continue
    const t = Math.sqrt(d2) / op.radius // 0 center -> 1 edge
    const k = Math.pow(Math.max(0, 1 - t), op.falloff)
    if (k <= 0) continue
    const s = op.strength * k
    positions[i] += normals[i] * s
    positions[i + 1] += normals[i + 1] * s
    positions[i + 2] += normals[i + 2] * s
    moved++
  }
  return moved
}

/** Area-weighted smooth normals for indexed geometry. */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const abx = positions[b] - positions[a]
    const aby = positions[b + 1] - positions[a + 1]
    const abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a]
    const acy = positions[c + 1] - positions[a + 1]
    const acz = positions[c + 2] - positions[a + 2]
    // face normal (unnormalized, area-weighted)
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    normals[a] += nx
    normals[a + 1] += ny
    normals[a + 2] += nz
    normals[b] += nx
    normals[b + 1] += ny
    normals[b + 2] += nz
    normals[c] += nx
    normals[c + 1] += ny
    normals[c + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= l
    normals[i + 1] /= l
    normals[i + 2] /= l
  }
  return normals
}

/** Rebuild positions+normals from base geometry plus an op list. */
export function rebuildDisplaced(
  basePositions: Float32Array,
  indices: Uint32Array,
  ops: DisplaceOp[],
): MeshData {
  const positions = Float32Array.from(basePositions)
  let normals = computeNormals(positions, indices)
  const data: MeshData = { positions, normals, indices }
  for (const op of ops) {
    applyDisplaceOp(data, op)
    data.normals = computeNormals(data.positions, indices)
  }
  return data
}

/** Base primitive grids (indexed). Segments control sculpt resolution. */
export function basePlate(w: number, h: number, depth: number, seg: number): MeshData {
  const sx = Math.max(1, Math.round(seg))
  const sy = Math.max(1, Math.round((seg * h) / Math.max(w, 1)))
  const sz = Math.max(1, Math.round((seg * depth) / Math.max(w, 1)))
  const pos: number[] = []
  const idx: number[] = []
  type V3 = [number, number, number]
  // Each face: origin corner, u/v edge vectors, grid counts, flip (winding).
  const faces: { o: V3; u: V3; v: V3; nu: number; nv: number; flip: boolean }[] = [
    { o: [-w / 2, -h / 2, depth / 2], u: [w, 0, 0], v: [0, h, 0], nu: sx, nv: sy, flip: false }, // front
    { o: [w / 2, -h / 2, -depth / 2], u: [-w, 0, 0], v: [0, h, 0], nu: sx, nv: sy, flip: false }, // back
    { o: [w / 2, -h / 2, -depth / 2], u: [0, 0, depth], v: [0, h, 0], nu: sz, nv: sy, flip: true }, // right
    { o: [-w / 2, -h / 2, depth / 2], u: [0, 0, -depth], v: [0, h, 0], nu: sz, nv: sy, flip: true }, // left
    { o: [-w / 2, h / 2, -depth / 2], u: [w, 0, 0], v: [0, 0, depth], nu: sx, nv: sz, flip: true }, // top
    { o: [-w / 2, -h / 2, depth / 2], u: [w, 0, 0], v: [0, 0, -depth], nu: sx, nv: sz, flip: true }, // bottom
  ]
  for (const f of faces) {
    const base = pos.length / 3
    for (let j = 0; j <= f.nv; j++) {
      for (let i = 0; i <= f.nu; i++) {
        const fu = i / f.nu
        const fv = j / f.nv
        pos.push(
          f.o[0] + f.u[0] * fu + f.v[0] * fv,
          f.o[1] + f.u[1] * fu + f.v[1] * fv,
          f.o[2] + f.u[2] * fu + f.v[2] * fv,
        )
      }
    }
    for (let j = 0; j < f.nv; j++) {
      for (let i = 0; i < f.nu; i++) {
        const a = base + j * (f.nu + 1) + i
        const b = a + 1
        const c = a + f.nu + 1
        const d = c + 1
        if (f.flip) idx.push(a, d, b, a, c, d)
        else idx.push(a, b, d, a, d, c)
      }
    }
  }
  const positions = new Float32Array(pos)
  const indices = new Uint32Array(idx)
  return { positions, normals: computeNormals(positions, indices), indices }
}

/** Base cylinder (axis = Z, radius r, height depth). */
export function baseCylinder(r: number, depth: number, seg: number): MeshData {
  const radial = Math.max(8, Math.round(seg * 2))
  const rings = Math.max(1, Math.round(seg / 3))
  const pos: number[] = []
  const idx: number[] = []
  // side
  for (let j = 0; j <= rings; j++) {
    const z = -depth / 2 + (depth * j) / rings
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z)
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i
      const b = a + 1
      const c = a + radial + 1
      const d = c + 1
      idx.push(a, b, d, a, d, c)
    }
  }
  // caps (top ring = j==rings at +z, bottom ring = j==0 at -z)
  const capBase = pos.length / 3
  pos.push(0, 0, depth / 2, 0, 0, -depth / 2)
  for (let i = 0; i < radial; i++) {
    const b0 = rings * (radial + 1) + i
    const b1 = rings * (radial + 1) + i + 1
    const a0 = i
    const a1 = i + 1
    idx.push(capBase, b0, b1) // top (+z, CCW from above)
    idx.push(capBase + 1, a1, a0) // bottom (-z)
  }
  const positions = new Float32Array(pos)
  const indices = new Uint32Array(idx)
  return { positions, normals: computeNormals(positions, indices), indices }
}

/** Base sphere (radius r). */
export function baseSphere(r: number, seg: number): MeshData {
  const nu = Math.max(8, Math.round(seg * 2))
  const nv = Math.max(4, Math.round(seg))
  const pos: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= nv; j++) {
    const theta = (j / nv) * Math.PI
    for (let i = 0; i <= nu; i++) {
      const phi = (i / nu) * Math.PI * 2
      pos.push(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta),
      )
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      const b = a + 1
      const c = a + nu + 1
      const d = c + 1
      idx.push(a, d, b, a, c, d)
    }
  }
  const positions = new Float32Array(pos)
  const indices = new Uint32Array(idx)
  return { positions, normals: computeNormals(positions, indices), indices }
}
