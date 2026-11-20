// ============================================================================
// Aerodynamics: arcade lifting-surface model in 3D. Wings fly in the XY
// plane (side-view machines); Z motion is damped. Pure math; the world
// applies forces at the part position so pitch torques emerge naturally.
// ============================================================================

export interface WingSample {
  /** Chord direction (unit, world). */
  tx: number
  ty: number
  /** Surface normal (unit, world). */
  nx: number
  ny: number
  /** Velocity (px/s, world). */
  vx: number
  vy: number
  /** Lift area (chord * thickness * span factor). */
  area: number
  /** Profile-drag area (chord * thickness). */
  dragArea: number
}

/** Tunables (calibrated headless: ~1.2g at rotation speed). */
export const LIFT_COEF = 0.75
export const WING_DRAG_COEF = 0.002
export const BODY_DRAG_COEF = 0.0012

/** Maximum angular acceleration used by the powered attitude-recovery servo. */
export const ATTITUDE_RECOVERY_MAX_ALPHA = 4 // rad/s^2
const ATTITUDE_RECOVERY_KP = 2.5 // 1/s^2
const ATTITUDE_RECOVERY_KD = 1.5 // 1/s

/** Returns lift/drag force (fx, fy) in px/s^2 * mass units (acceleration). */
export function wingAccel(w: WingSample): { fx: number; fy: number } {
  const vt = w.vx * w.tx + w.vy * w.ty
  const vn = w.vx * w.nx + w.vy * w.ny
  const speed = Math.hypot(w.vx, w.vy)
  if (speed < 1) return { fx: 0, fy: 0 }
  const fn = -LIFT_COEF * w.area * vn * speed
  const ft = -(WING_DRAG_COEF * w.dragArea + BODY_DRAG_COEF) * vt * speed
  return { fx: w.nx * fn + w.tx * ft, fy: w.ny * fn + w.ty * ft }
}

/** Weathervane assist: PD drives the wing's angle-of-attack toward a trim
 * value and damps pitch rotation. Returns angular acceleration (rad/s^2). */
export function assistTorque(
  aoaDiffRad: number,
  angVelZ: number,
  dyn: number,
  strength: number,
): number {
  // aoaDiff > 0 = too much AoA -> nose-down torque reduces it.
  return (-aoaDiffRad * 0.06 - angVelZ * 0.04) * dyn * strength
}

/** World-Z angular acceleration for powered nose-down attitude recovery.
 * Positive pitch and pitch rate are nose-up in the physics world. */
export function attitudeRecoveryAccel(
  pitchRad: number,
  pitchRateRad: number,
  powered: boolean,
  recovering: boolean,
): number {
  if (!powered || !recovering) return 0
  const error = -pitchRad
  const alpha = ATTITUDE_RECOVERY_KP * error - ATTITUDE_RECOVERY_KD * pitchRateRad
  return Math.max(
    -ATTITUDE_RECOVERY_MAX_ALPHA,
    Math.min(ATTITUDE_RECOVERY_MAX_ALPHA, alpha),
  )
}
