// ============================================================================
// Physical materials + 3D size defaults. Densities are relative (water
// buoyancy keys off the fluid/body density ratio, so wood floats, steel
// sinks, in any unit system).
// ============================================================================

import type { HardwarePartType, Material } from '../types'

export interface MaterialDef {
  density: number
  friction: number
  frictionStatic: number
  restitution: number
  metalness: number
  roughness: number
}

export const MATERIALS: Record<Material, MaterialDef> = {
  wood: { density: 0.0006, friction: 0.55, frictionStatic: 0.9, restitution: 0.12, metalness: 0.05, roughness: 0.8 },
  steel: { density: 0.004, friction: 0.35, frictionStatic: 0.6, restitution: 0.05, metalness: 0.85, roughness: 0.35 },
  iron: { density: 0.0045, friction: 0.4, frictionStatic: 0.7, restitution: 0.04, metalness: 0.7, roughness: 0.5 },
  acrylic: { density: 0.0012, friction: 0.2, frictionStatic: 0.35, restitution: 0.35, metalness: 0.1, roughness: 0.15 },
  rubber: { density: 0.0012, friction: 0.95, frictionStatic: 1.2, restitution: 0.08, metalness: 0.0, roughness: 0.9 },
  plastic: { density: 0.001, friction: 0.3, frictionStatic: 0.5, restitution: 0.28, metalness: 0.1, roughness: 0.5 },
  organic: { density: 0.00045, friction: 0.35, frictionStatic: 0.5, restitution: 0.32, metalness: 0.0, roughness: 0.7 },
}

export function defaultMaterialFor(kind: HardwarePartType): Material {
  switch (kind) {
    case 'wheel':
      return 'rubber'
    case 'board':
    case 'chassis':
    case 'axle':
      return 'wood'
    case 'gear':
    case 'propeller':
      return 'steel'
    case 'wing':
    case 'block':
    case 'deco':
      return 'acrylic'
    case 'duck':
    case 'plant':
      return 'organic'
    case 'thruster':
    case 'batteryPack':
    case 'emitter':
      return 'steel'
    case 'ledBulb':
    case 'switchPad':
    case 'speaker':
      return 'plastic'
    case 'water':
      return 'plastic'
    default:
      return 'plastic'
  }
}

/** Circular (cylinder-collider) part kinds. */
export function isCircleKind(kind: HardwarePartType): boolean {
  return kind === 'wheel' || kind === 'gear' || kind === 'duck'
}

/** Default air damping feel per kind (used for compound averaging). */
export function defaultFrictionAir(kind: HardwarePartType): number {
  switch (kind) {
    case 'wing':
      return 0.012
    case 'propeller':
      return 0.008
    case 'duck':
    case 'plant':
      return 0.02
    case 'thruster':
      return 0.008
    default:
      return 0.008
  }
}

/** Default extrusion depth (Z thickness) per kind. */
export function defaultDepthFor(kind: HardwarePartType): number {
  switch (kind) {
    case 'wheel':
      return 30
    case 'board':
      return 24
    case 'chassis':
      return 40
    case 'gear':
      return 26
    case 'propeller':
      return 12
    case 'wing':
      return 20
    case 'axle':
      return 16
    case 'duck':
      return 34
    case 'block':
      return 50
    case 'deco':
      return 40
    case 'plant':
      return 40
    case 'thruster':
      return 30
    case 'ledBulb':
      return 24
    case 'switchPad':
      return 22
    case 'speaker':
      return 44
    case 'batteryPack':
      return 34
    case 'emitter':
      return 26
    case 'water':
      return 120
    default:
      return 24
  }
}

export function partDepthOf(kind: HardwarePartType, propsDepth: number | undefined): number {
  return typeof propsDepth === 'number' && propsDepth > 2 ? propsDepth : defaultDepthFor(kind)
}
