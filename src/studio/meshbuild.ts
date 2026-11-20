// ============================================================================
// Mesh library (Three.js side): geometry from CustomMesh specs + raw
// buffers for Rapier colliders.
// ============================================================================

import * as THREE from 'three'
import type { CustomMesh } from '../types'
import { buildMeshData } from './meshdata'
import type { MeshData } from './displace'

export { buildMeshData }
export type { MeshData }

export function meshDataToGeometry(data: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  g.setIndex(new THREE.BufferAttribute(data.indices, 1))
  g.computeBoundingSphere()
  return g
}

export function buildMeshGeometry(mesh: CustomMesh): THREE.BufferGeometry {
  return meshDataToGeometry(buildMeshData(mesh))
}

/** Raw buffers for Rapier convexHull / trimesh colliders. */
export function meshColliderBuffers(mesh: CustomMesh): { positions: Float32Array; indices: Uint32Array } {
  const data = buildMeshData(mesh)
  return { positions: data.positions, indices: data.indices }
}
