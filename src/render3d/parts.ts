// ============================================================================
// 3D part factory: Three.js Groups for every hardware kind + custom studio
// meshes. Origin at part center, +X forward. Refs for live state (glow,
// levers, flames) are stashed in group.userData.refs.
// ============================================================================

import * as THREE from 'three'
import type { CustomMesh, HardwarePartData } from '../types'
import { MATERIALS, defaultMaterialFor, partDepthOf } from '../physics/materials'
import { buildMeshGeometry } from '../studio/meshbuild'

export interface PartRefs {
  glowMats: THREE.MeshStandardMaterial[]
  sprites: THREE.Sprite[]
  flame?: THREE.Mesh
  lever?: THREE.Mesh
  rings?: THREE.Mesh[]
}

let glowTexture: THREE.CanvasTexture | null = null
export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

export function materialColor(part: HardwarePartData): string {
  if (part.props.color) return part.props.color
  const mat = part.props.material ?? defaultMaterialFor(part.kind)
  const map: Record<string, string> = {
    wood: '#b07a45',
    steel: '#8b98a8',
    iron: '#6b7280',
    acrylic: '#7dd3fc',
    rubber: '#1f2937',
    plastic: '#c084fc',
    organic: '#4ade80',
  }
  return map[mat] ?? '#94a3b8'
}

function std(color: string, mat: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const def = MATERIALS[mat as keyof typeof MATERIALS] ?? MATERIALS.plastic
  return new THREE.MeshStandardMaterial({
    color,
    roughness: def.roughness,
    metalness: def.metalness,
    ...extra,
  })
}

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function cylZ(r: number, depth: number, m: THREE.Material, seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, seg), m)
  mesh.rotation.x = Math.PI / 2 // axis Y -> Z
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function glowSprite(color: string, size: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const s = new THREE.Sprite(mat)
  s.scale.set(size, size, 1)
  return s
}

export function buildPartMesh(
  part: HardwarePartData,
  meshLib: Map<string, CustomMesh>,
): { group: THREE.Group; refs: PartRefs } {
  const refs: PartRefs = { glowMats: [], sprites: [] }
  const group = new THREE.Group()
  const mat = part.props.material ?? defaultMaterialFor(part.kind)
  const base = materialColor(part)
  const w = Math.max(4, part.w)
  const h = Math.max(4, part.h)
  const d = partDepthOf(part.kind, part.props.depth)

  // Custom studio mesh overrides the kind shape.
  if (part.props.meshId) {
    const spec = meshLib.get(part.props.meshId)
    if (spec) {
      try {
        const geo = buildMeshGeometry(spec)
        const mesh = new THREE.Mesh(geo, std(base, mat))
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.add(mesh)
        return { group, refs }
      } catch {
        /* fall through to kind shape */
      }
    }
  }

  const add = (m: THREE.Object3D) => group.add(m)

  switch (part.kind) {
    case 'board':
    case 'block':
    case 'deco': {
      const acrylic = mat === 'acrylic'
      add(box(w, h, d, std(base, mat, acrylic ? { transparent: true, opacity: 0.55 } : {})))
      if (part.kind === 'deco') {
        const stripe = box(w * 0.9, h * 0.18, d + 1, std('#ffffff', 'plastic', { transparent: true, opacity: 0.5 }))
        stripe.rotation.z = 0.5
        add(stripe)
      }
      break
    }
    case 'chassis': {
      add(box(w, h, d, std(base, mat)))
      const stripe = box(w * 0.96, h * 0.22, d + 1, std('#ef4444', 'plastic'))
      stripe.position.y = -h * 0.2
      add(stripe)
      const cabin = box(w * 0.4, h * 0.9, d * 0.8, std('#1e293b', 'plastic'))
      cabin.position.set(-w * 0.08, h * 0.65, 0)
      add(cabin)
      break
    }
    case 'wheel': {
      const r = w / 2
      add(cylZ(r, d, std('#111827', 'rubber', { roughness: 0.95 }), 28))
      const hub = cylZ(r * 0.45, d + 2, std(base, mat), 20)
      add(hub)
      for (let i = 0; i < 5; i++) {
        const spoke = box(r * 0.8, 4, d + 3, std('#0f172a', 'plastic'))
        spoke.rotation.z = (i / 5) * Math.PI * 2
        spoke.position.set(Math.cos((i / 5) * Math.PI * 2) * 0, 0, 0)
        // offset along spoke direction
        const a = (i / 5) * Math.PI * 2
        spoke.position.set(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, 0)
        add(spoke)
      }
      break
    }
    case 'gear': {
      const r = w / 2
      const teeth = Math.max(6, Math.round(Number(part.props.teeth ?? 12)))
      add(cylZ(r * 0.84, d, std(base, mat), 28))
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2
        const tooth = box(r * 0.24, r * 0.16, d * 0.9, std(base, mat))
        tooth.position.set(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 0)
        tooth.rotation.z = a
        add(tooth)
      }
      const hole = cylZ(r * 0.22, d + 2, std('#0f172a', 'plastic'), 16)
      add(hole)
      break
    }
    case 'propeller': {
      const blade = box(w, Math.max(8, h), d * 0.7, std('#475569', 'plastic'))
      add(blade)
      const tipL = box(8, Math.max(8, h), d * 0.75, std('#ef4444', 'plastic'))
      tipL.position.x = -w / 2 + 4
      add(tipL)
      const tipR = tipL.clone()
      tipR.position.x = w / 2 - 4
      add(tipR)
      const hub = new THREE.Mesh(new THREE.SphereGeometry(11, 16, 12), std('#94a3b8', 'steel'))
      hub.castShadow = true
      add(hub)
      break
    }
    case 'wing': {
      const m = std(base, mat, mat === 'acrylic' ? { transparent: true, opacity: 0.75 } : {})
      add(box(w, h, d, m))
      const tip = box(w * 0.2, h * 0.7, d * 0.9, m)
      tip.position.x = w * 0.45
      add(tip)
      break
    }
    case 'axle': {
      const m = box(w, h, d, std(base, mat))
      add(m)
      break
    }
    case 'duck': {
      const r = w / 2
      const yellow = std('#facc15', 'organic')
      const bodyM = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), yellow)
      bodyM.scale.set(1, 0.85, 0.8)
      bodyM.castShadow = true
      add(bodyM)
      const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 12), yellow)
      head.position.set(r * 0.45, r * 0.55, 0)
      head.castShadow = true
      add(head)
      const beak = new THREE.Mesh(new THREE.ConeGeometry(r * 0.18, r * 0.4, 12), std('#fb923c', 'plastic'))
      beak.rotation.z = -Math.PI / 2
      beak.position.set(r * 0.95, r * 0.5, 0)
      add(beak)
      const eyeM = std('#0f172a', 'plastic')
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 8, 8), eyeM)
        eye.position.set(r * 0.58, r * 0.68, s * r * 0.32)
        add(eye)
      }
      break
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.22, h * 0.35, 14), std('#a16207', 'plastic'))
      pot.position.y = h * 0.3
      pot.castShadow = true
      add(pot)
      const leafM = std('#22c55e', 'organic')
      const leafPos: [number, number, number, number][] = [
        [-w * 0.15, h * 0.05, 0, -0.6],
        [w * 0.15, h * 0.1, 0, 0.6],
        [0, h * 0.3, 0, 0],
      ]
      for (const [lx, ly, lz, la] of leafPos) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(w * 0.2, 12, 8), leafM)
        leaf.scale.set(1, 0.45, 0.6)
        leaf.position.set(lx, ly, lz)
        leaf.rotation.z = la
        leaf.castShadow = true
        add(leaf)
      }
      break
    }
    case 'thruster': {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.32, h * 0.5, w * 0.55, 16), std('#475569', 'steel'))
      noz.rotation.z = Math.PI / 2
      noz.position.x = w * 0.05
      noz.castShadow = true
      add(noz)
      const flameM = new THREE.MeshBasicMaterial({ color: '#fdba74', transparent: true, opacity: 0.9 })
      const flame = new THREE.Mesh(new THREE.ConeGeometry(h * 0.24, w * 1.6, 14), flameM)
      flame.rotation.z = Math.PI / 2
      flame.position.x = w * 0.55 + w * 0.8
      flame.visible = false
      add(flame)
      refs.flame = flame
      const spr = glowSprite('#fb923c', w * 1.4)
      spr.position.x = w * 0.6
      add(spr)
      refs.sprites.push(spr)
      break
    }
    case 'ledBulb': {
      const baseM = box(w * 0.44, h * 0.4, d * 0.8, std('#334155', 'plastic'))
      baseM.position.y = h * 0.3
      add(baseM)
      const domeM = new THREE.MeshStandardMaterial({
        color: '#475569',
        emissive: '#ffffff',
        emissiveIntensity: 0,
        roughness: 0.3,
      })
      const dome = new THREE.Mesh(new THREE.SphereGeometry(w * 0.34, 16, 12), domeM)
      dome.position.y = -h * 0.1
      dome.castShadow = true
      add(dome)
      refs.glowMats.push(domeM)
      const spr = glowSprite('#fde68a', w * 3.2)
      spr.position.y = -h * 0.1
      add(spr)
      refs.sprites.push(spr)
      break
    }
    case 'switchPad': {
      add(box(w, h * 0.35, d, std('#1e293b', 'plastic')))
      const leverM = std('#94a3b8', 'plastic')
      const lever = box(5, h * 0.9, 5, leverM)
      lever.geometry.translate(0, h * 0.45, 0) // pivot at base
      lever.position.y = h * 0.15
      add(lever)
      refs.lever = lever
      const dotM = new THREE.MeshStandardMaterial({ color: '#475569', emissive: '#22c55e', emissiveIntensity: 0 })
      const dot = new THREE.Mesh(new THREE.SphereGeometry(3.5, 10, 8), dotM)
      dot.position.set(-w * 0.32, -h * 0.32, d / 2)
      add(dot)
      refs.glowMats.push(dotM)
      break
    }
    case 'speaker': {
      add(box(w, h, d, std('#1e293b', 'plastic')))
      refs.rings = []
      for (let i = 1; i <= 3; i++) {
        const r = (Math.min(w, h) / 2 - 4) * (i / 3)
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(Math.max(2, r), 1.6, 8, 24),
          std('#64748b', 'plastic'),
        )
        ring.position.z = d / 2 + 1
        add(ring)
        refs.rings.push(ring)
      }
      break
    }
    case 'batteryPack': {
      add(box(w, h, d, std('#166534', 'plastic')))
      const bolt = box(w * 0.16, h * 0.4, d * 0.4, new THREE.MeshStandardMaterial({ color: '#fef08a', emissive: '#eab308', emissiveIntensity: 0.7 }))
      add(bolt)
      for (const s of [-1, 1]) {
        const nub = box(6, 7, 6, std('#bbf7d0', 'plastic'))
        nub.position.set(s * 7, -h / 2 - 3, 0)
        add(nub)
      }
      break
    }
    case 'emitter': {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.18, h * 0.18, w * 0.7, 14), std('#64748b', 'steel'))
      pipe.rotation.z = Math.PI / 2
      pipe.position.x = -w * 0.15
      pipe.castShadow = true
      add(pipe)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3, w * 0.3, 14), std('#334155', 'steel'))
      cone.rotation.z = -Math.PI / 2
      cone.position.x = w * 0.35
      add(cone)
      break
    }
    default:
      add(box(w, h, d, std(base, mat)))
      break
  }

  // name tag anchor (views may add sprites)
  group.userData.partKind = part.kind
  return { group, refs }
}
