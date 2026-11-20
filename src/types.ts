// ============================================================================
// SCHEMACHINE — Core data model shared across circuit, hardware, sync, UI.
// ============================================================================

export type CircuitComponentType =
  | 'battery'
  | 'ground'
  | 'resistor'
  | 'diode'
  | 'led'
  | 'switchPush'
  | 'switchSlide'
  | 'potentiometer'
  | 'motor'
  | 'buzzer'
  | 'gate'
  | 'transistor'
  | 'fuse'
  | 'capacitor'
  | 'inductor'
  | 'schottky'
  | 'zenerDiode'
  | 'rgbLed'
  | 'incandescent'
  | 'photoresistor'
  | 'thermistor'
  | 'relay'
  | 'mosfet'
  | 'currentSource'
  | 'clock'
  | 'opAmp'
  | 'solenoid'
  | 'fan'
  | 'speaker'

export type GateType = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR'
export type TransistorKind = 'NPN' | 'PNP'
export type MosfetKind = 'N' | 'P'
export type LedColor = 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'rgb'

export interface CircuitComponentData {
  id: string
  /** User-editable unique display name — used by the binding registry. */
  name: string
  type: CircuitComponentType
  x: number
  y: number
  props: CircuitProps
}

export interface CircuitProps {
  /** Battery / supply voltage in volts. */
  voltage?: number
  /** Resistance in ohms (resistor, potentiometer total, motor winding, buzzer coil). */
  resistance?: number
  /** Forward voltage for diodes / LEDs. */
  forwardVoltage?: number
  /** LED color. */
  color?: LedColor
  /** Gate type (gate components). */
  gateType?: GateType
  /** Transistor kind. */
  transistorKind?: TransistorKind
  /** PC keyboard key code bound to this switch (e.g. 'Space', 'KeyW', 'ArrowUp'). */
  key?: string
  /** Initial / current closed state for switches. */
  closed?: boolean
  /** Potentiometer wiper position 0..1. */
  position?: number
  /** Motor back-EMF constant (V per rad/s). */
  ke?: number
  /** Motor velocity gain — target angular velocity per volt (rad/s per V). */
  kv?: number
  /** Maximum current in amps (battery fuse trip / motor rating / fuse rating). */
  maxCurrent?: number
  /** Buzzer frequency in Hz. */
  frequency?: number
  /** Battery tripped state (short-circuit protection). */
  tripped?: boolean
  /** Fuse blown state. */
  blown?: boolean
  /** Hardware part name this circuit component is bound to (reverse link). */
  bindHardware?: string
  /** Saturation collector-emitter resistance for transistors. */
  rce?: number
  capacitance?: number
  inductance?: number
  initialVoltage?: number
  initialCurrent?: number
  zenerVoltage?: number
  lightLevel?: number
  darkResistance?: number
  beta?: number
  temperature?: number
  pickupVoltage?: number
  mosfetKind?: MosfetKind
  thresholdVoltage?: number
  rdsOn?: number
  current?: number
  dutyCycle?: number
  amplitude?: number
  gain?: number
  ratedPower?: number
  outputResistance?: number
}

export interface WireEndpoint {
  componentId: string
  pin: string
}

export interface WireData {
  id: string
  from: WireEndpoint
  to: WireEndpoint
}

export interface CircuitData {
  components: CircuitComponentData[]
  wires: WireData[]
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export type HardwarePartType =
  | 'board' // structural plate / beam
  | 'chassis' // vehicle chassis
  | 'wheel' // tire / wheel (circle)
  | 'gear'
  | 'propeller'
  | 'wing'
  | 'axle'
  | 'duck'
  | 'block'
  | 'deco'
  | 'plant'
  | 'thruster'
  | 'ledBulb'
  | 'switchPad'
  | 'speaker'
  | 'batteryPack'
  | 'emitter'
  | 'water' // fluid region (static sensor volume)

export type Material =
  | 'wood'
  | 'steel'
  | 'iron'
  | 'acrylic'
  | 'rubber'
  | 'plastic'
  | 'organic'

export interface HardwarePartData {
  id: string
  /** User-editable name — registers in the global binding pool. */
  name: string
  kind: HardwarePartType
  x: number
  y: number
  /** Depth position (toward viewer). 2D-authored parts use 0. */
  z: number
  angle: number
  /** Width (boxes) or diameter (circles). */
  w: number
  /** Height (boxes). Unused for circles. */
  h: number
  props: HardwareProps
}

export interface HardwareProps {
  material?: Material
  color?: string
  isStatic?: boolean
  /** Circuit component name this physical electrical part is bound to. */
  boundComponent?: string
  /** Facing direction offset in degrees (thruster nozzle, LED cone, emitter). */
  direction?: number
  /** Thruster force scale. */
  force?: number
  /** Emitter particle spawn rate (particles per second). */
  rate?: number
  /** Fluid density for water regions (default 0.001). */
  density?: number
  /** Raceway current for water regions (px per normalized step). */
  flowX?: number
  flowY?: number
  /** Gear teeth count. */
  teeth?: number
  /** Collision radius override for circular parts (visual size unchanged). */
  collisionR?: number
  /** Extrusion depth / thickness in the Z axis (defaults per kind). */
  depth?: number
  /** Custom mesh id from the Part Studio library (overrides kind shape). */
  meshId?: string
  /** Initial linear velocity (2D coords, px/s) applied at world build. */
  v0?: { x: number; y: number }
  /** Flight assist (weathervane pitch stability) for airframes. */
  assist?: boolean
  /** Extra metadata (free-form). */
  meta?: Record<string, unknown>
}

export type JointType = 'weld' | 'pin' | 'motor' | 'slider'

export interface JointData {
  id: string
  type: JointType
  /** Part id of side A (typically the carrier / stator). */
  a: string
  /** Part id of side B (typically the attached child / rotor). */
  b: string
  /** Attachment point offset in A's local coordinates. */
  ax: number
  ay: number
  /** Attachment point offset in B's local coordinates. */
  bx: number
  by: number
  props: JointProps
}

export interface JointProps {
  /** Circuit motor component name (motor joints). */
  boundComponent?: string
  /** Motor velocity gain, rad/s per volt. Default derived from circuit motor. */
  kv?: number
  /** Motor acceleration limit, rad/s per second. */
  maxAccel?: number
  /** Angular limits in degrees (relative to build pose) for pin/motor joints. */
  minAngle?: number
  maxAngle?: number
  /** Slider axis in A's local coordinates (degrees, 0 = +x). */
  axis?: number
  /** Revolute axis override for pin/motor joints: 'z' (screen plane,
   * default) or 'y' (vertical axis — azimuth sweep / turntables). */
  axis3d?: 'z' | 'y'
  /** Rack-and-pinion: linear displacement per radian of the driving motor. */
  ratio?: number
  /** Whether the slider is driven by a motor joint (rack-pinion coupling). */
  driveBy?: string
  /** Weld rigidity 0..1. */
  stiffness?: number
}

export interface HardwareData {
  parts: HardwarePartData[]
  joints: JointData[]
  /** Part Studio custom-shape library. */
  meshes: CustomMesh[]
}

// ---------------------------------------------------------------------------
// Part Studio custom meshes (fully serializable into .schemachine.json)
// ---------------------------------------------------------------------------

export type CustomMeshBase = 'plate' | 'cylinder' | 'sphere'

/** One parametric dent/bulge stamp in mesh-local coordinates. */
export interface DisplaceOp {
  /** Stamp center in mesh-local units. */
  x: number
  y: number
  z: number
  /** Brush radius in local units. */
  radius: number
  /** Depth along the surface normal (+ bulge, - indent). */
  strength: number
  /** Falloff exponent (1 = linear, higher = tighter). */
  falloff: number
}

export interface StlBlob {
  /** Base64 little-endian Float32 positions (x,y,z per vertex). */
  positions: string
  /** Base64 little-endian Uint32 triangle indices. */
  indices: string
  vertexCount: number
  triangleCount: number
}

export interface CustomMesh {
  id: string
  name: string
  base: CustomMeshBase
  /** Base primitive dimensions (local units ~= pixels). */
  w: number
  h: number
  depth: number
  /** Subdivision segments for displacement resolution. */
  segments: number
  /** Ordered dent/bulge stamps (reapplied deterministically). */
  ops: DisplaceOp[]
  /** Imported STL payload (base kind then only sets the fallback size). */
  stl?: StlBlob
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface ProjectData {
  version: number
  name: string
  /** World floor y coordinate (simulation ground plane). */
  groundY: number
  circuit: CircuitData
  hardware: HardwareData
}

// ---------------------------------------------------------------------------
// Runtime types (published by the engines, consumed by canvases)
// ---------------------------------------------------------------------------

export interface ComponentRuntimeState {
  /** Normalised 0..1 activation signal (switch closed, LED lit, gate HIGH...). */
  active: number
  brightness?: number
  closed?: boolean
  on?: boolean
  out?: number
  voltage?: number
  current?: number
  angularVelocity?: number
  tripped?: boolean
  blown?: boolean
  position?: number
  overloaded?: boolean
  frequency?: number
  gateType?: GateType
  resistance?: number
  temperature?: number
  lightLevel?: number
  power?: number
  channels?: { R: number; G: number; B: number }
  reverseBreakdown?: boolean
}

export interface WireRuntime {
  current: number
  vA: number
  vB: number
  overloaded: boolean
}

export interface CircuitRuntime {
  /** componentId -> pin -> voltage */
  pinVoltages: Map<string, Map<string, number>>
  /** wireId -> runtime */
  wires: Map<string, WireRuntime>
  /** componentId -> state */
  states: Map<string, ComponentRuntimeState>
  solved: boolean
  warnings: string[]
}

export const CURRENT_VERSION = 1

export const WIRE_OVERLOAD_AMPS = 8
