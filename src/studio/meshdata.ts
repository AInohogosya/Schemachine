// ============================================================================
// Pure mesh-data builder (no three.js): primitives + displacement ops +
// STL payloads -> indexed positions/normals. Used by physics colliders,
// the renderer, and the studio alike.
// ============================================================================

import type { CustomMesh } from '../types'
import { baseCylinder, basePlate, baseSphere, rebuildDisplaced, type MeshData } from './displace'
import { base64ToF32, base64ToU32, normalizeGeometry } from './stl'

export function buildMeshData(mesh: CustomMesh): MeshData {
  let base: MeshData
  if (mesh.stl) {
    try {
      const positions = base64ToF32(mesh.stl.positions)
      const indices = base64ToU32(mesh.stl.indices)
      if (positions.length >= 9 && indices.length >= 3) {
        const norm = normalizeGeometry({ positions, indices }, Math.max(mesh.w, mesh.h, mesh.depth))
        base = { positions: norm.positions, normals: new Float32Array(0), indices: norm.indices }
      } else {
        base = basePlate(mesh.w, mesh.h, mesh.depth, mesh.segments)
      }
    } catch {
      base = basePlate(mesh.w, mesh.h, mesh.depth, mesh.segments)
    }
  } else if (mesh.base === 'cylinder') {
    base = baseCylinder(Math.max(mesh.w, mesh.h) / 2, mesh.depth, mesh.segments)
  } else if (mesh.base === 'sphere') {
    base = baseSphere(Math.max(mesh.w, mesh.h, mesh.depth) / 2, mesh.segments)
  } else {
    base = basePlate(mesh.w, mesh.h, mesh.depth, mesh.segments)
  }
  if (mesh.ops.length === 0) {
    return ensureNormals(base)
  }
  return rebuildDisplaced(base.positions, base.indices, mesh.ops)
}

function ensureNormals(data: MeshData): MeshData {
  if (data.normals.length === data.positions.length) return data
  return rebuildDisplaced(data.positions, data.indices, [])
}
