// ============================================================================
// Fluids: analytic Archimedes buoyancy + viscous drag + raceway current
// entrainment. Pure math over plain data; the world applies the forces.
// Units: pixels, seconds. Gravity magnitude passed in (positive number).
// ============================================================================

export interface WaterRegion3D {
  cx: number
  cy: number
  cz: number
  hx: number
  hy: number
  hz: number
  density: number
  flowX: number
  flowY: number
  flowZ: number
}

export interface BodySample {
  /** World-space axis-aligned bounds. */
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  /** Volume in px^3 (for displaced-weight ratio). */
  volume: number
  /** Body density. */
  density: number
}

/** Fraction of the sample volume inside the region (0..1). */
export function submergedFraction3D(s: BodySample, r: WaterRegion3D): number {
  const ox = Math.min(s.maxX, r.cx + r.hx) - Math.max(s.minX, r.cx - r.hx)
  if (ox <= 0) return 0
  const oy = Math.min(s.maxY, r.cy + r.hy) - Math.max(s.minY, r.cy - r.hy)
  if (oy <= 0) return 0
  const oz = Math.min(s.maxZ, r.cz + r.hz) - Math.max(s.minZ, r.cz - r.hz)
  if (oz <= 0) return 0
  const overlap = ox * oy * oz
  const vol = Math.max(1, (s.maxX - s.minX) * (s.maxY - s.minY) * (s.maxZ - s.minZ))
  return Math.min(1, overlap / vol)
}

export interface FluidForce {
  /** Buoyancy acceleration factor: multiply by mass*gravity for force. */
  buoy: number
  /** Linear drag coefficient (per second). */
  drag: number
  /** Current velocity to entrain toward (px/s). */
  flowX: number
  flowY: number
  flowZ: number
  /** Entrainment strength (per second rate toward flow). */
  entrain: number
  submerged: number
}

/** Combine all regions into one force descriptor for a body part. */
export function fluidForcesFor(
  s: BodySample,
  regions: WaterRegion3D[],
  gravity: number,
): FluidForce {
  let buoy = 0
  let drag = 0
  let flowX = 0
  let flowY = 0
  let flowZ = 0
  let entrain = 0
  let submerged = 0
  void gravity
  for (const r of regions) {
    const frac = submergedFraction3D(s, r)
    if (frac <= 0.001) continue
    submerged = Math.min(1, submerged + frac)
    const bodyDensity = Math.max(1e-9, s.density)
    // Displaced-fluid weight relative to body weight (unit-agnostic).
    buoy += Math.min(2.5, (r.density / bodyDensity) * frac)
    drag += 0.9 * frac
    if (r.flowX !== 0 || r.flowY !== 0 || r.flowZ !== 0) {
      const k = Math.min(1, frac * 1.6)
      flowX += r.flowX * k
      flowY += r.flowY * k
      flowZ += (r.flowZ ?? 0) * k
      entrain += 2.2 * k
    }
  }
  return { buoy, drag, flowX, flowY, flowZ, entrain, submerged }
}
