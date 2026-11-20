// ============================================================================
// SCHEMACHINE circuit solver — real Modified Nodal Analysis (MNA).
//
// Every schematic compiles to a nodal network. Each 60 Hz tick stamps dynamic
// element models (switches, diodes, LEDs, transistors, potentiometers,
// batteries with internal resistance, gate voltage drivers, motor windings
// plus back-EMF sources) and solves the full linear system with partial
// pivoting. Nonlinear elements (diodes / LEDs / transistors) are linearised
// around the previous iteration state and resolved iteratively until stable.
//
// Voltage sources always carry a series resistance (battery internal R, gate
// output R) so short circuits degrade to finite huge currents and trigger the
// protection logic instead of a singular matrix.
// ============================================================================

import type {
  CircuitComponentData,
  CircuitData,
  ComponentRuntimeState,
  CircuitProps,
  CircuitRuntime,
  WireData,
} from '../types'
import { COMPONENT_DEFS, GATE_LABELS, gateHasSecondInput } from './components'

export const LOGIC_HIGH_V = 5.0
export const LOGIC_THRESHOLD_V = 2.5
const LEAK_G = 1e-9 // leakage conductance: every node to ground (keeps matrix non-singular)
const R_OFF = 1e7 // open switch / blown fuse resistance
const R_ON_SWITCH = 0.01
const R_FUSE = 0.01
const BATTERY_RINT = 0.05
const GATE_ROUT = 5.0
const MAX_ITER = 12
/** Diode/LED dynamic resistance (ohms) for the Norton equivalent. */
const DIODE_RD = 6
const DEFAULT_DT = 1 / 60
const MIN_DT = 1e-5
const MAX_DT = 0.1
const MAX_STATE = 1e9

function prop(props: CircuitProps, key: keyof CircuitProps, fallback: number): number {
  const v = props[key] as unknown
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function boundedProp(props: CircuitProps, key: keyof CircuitProps, fallback: number, low: number, high: number): number {
  return clamp(prop(props, key, fallback), low, high)
}

export function transientTimeStep(lastNow: number | null, now: number): number {
  if (lastNow === null || !Number.isFinite(lastNow) || !Number.isFinite(now)) return DEFAULT_DT
  const elapsed = (now - lastNow) / 1000
  return elapsed > 0 ? clamp(elapsed, MIN_DT, MAX_DT) : DEFAULT_DT
}

export function photoresistorResistance(props: CircuitProps): number {
  const bright = boundedProp(props, 'resistance', 1000, 1e-3, 1e9)
  const dark = boundedProp(props, 'darkResistance', 1000000, bright, 1e12)
  const light = boundedProp(props, 'lightLevel', 0.5, 0, 1)
  return clamp(dark * Math.pow(bright / dark, light), 1e-3, 1e12)
}

export function thermistorResistance(props: CircuitProps): number {
  const nominal = boundedProp(props, 'resistance', 10000, 1e-3, 1e12)
  const beta = boundedProp(props, 'beta', 3950, 0, 100000)
  const celsius = boundedProp(props, 'temperature', 25, -273.14, 1000)
  const kelvin = celsius + 273.15
  const exponent = clamp(beta * (1 / kelvin - 1 / 298.15), -80, 80)
  return clamp(nominal * Math.exp(exponent), 1e-3, 1e12)
}

export function clockVoltage(props: CircuitProps, now: number): number {
  const frequency = boundedProp(props, 'frequency', 1, 1e-6, 1000000)
  const amplitude = boundedProp(props, 'amplitude', 5, -1000, 1000)
  const duty = boundedProp(props, 'dutyCycle', 0.5, 0, 1)
  const time = Number.isFinite(now) ? now / 1000 : 0
  const phase = ((time * frequency) % 1 + 1) % 1
  return phase < duty ? amplitude : 0
}

export function incandescentBrightness(voltage: number, current: number, ratedPower: number): number {
  const rating = Number.isFinite(ratedPower) && ratedPower > 0 ? ratedPower : 12
  return clamp(Math.abs(voltage * current) / rating, 0, 1)
}

export function opAmpTarget(
  props: CircuitProps,
  inPlus: number,
  inMinus: number,
  railPlus: number,
  railMinus: number,
): number {
  const gain = boundedProp(props, 'gain', 100000, 0, 1e9)
  const low = Math.min(railPlus, railMinus)
  const high = Math.max(railPlus, railMinus)
  const target = gain * (inPlus - inMinus)
  return clamp(Number.isFinite(target) ? target : target < 0 ? low : high, low, high)
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface PinNodeRef {
  componentId: string
  pin: string
  node: number
}

export interface CompiledComponent {
  data: CircuitComponentData
  pinNodes: Map<string, number>
  /** Internal helper node ids (-1 when unused). */
  nodeM: number
  /** Voltage source index (-1 when unused). */
  vsIndex: number
}

export interface TransientState {
  voltage: number
  current: number
}

export interface CompiledNetwork {
  circuit: CircuitData
  nodeCount: number
  vsCount: number
  comps: CompiledComponent[]
  compById: Map<string, CompiledComponent>
  wires: WireData[]
  /** Persistent nonlinear state (warm start): compId -> {on, R} */
  nl: Map<string, { on: boolean; R: number; flips: number; mode?: 'off' | 'forward' | 'reverse' }>
  transient: Map<string, TransientState>
  lastNow: number | null
  /** Protection state: batteryId -> {tripped, retryAt} (ms epoch) */
  protection: Map<string, { tripped: boolean; retryAt: number }>
  blownFuses: Set<string>
}

function getOrCreate<K>(map: Map<K, number>, key: K, maker: () => number): number {
  const v = map.get(key)
  if (v !== undefined) return v
  const n = maker()
  map.set(key, n)
  return n
}

export function compileCircuit(circuit: CircuitData): CompiledNetwork {
  const compById = new Map<string, CompiledComponent>()

  // --- union-find over pin keys ---
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let p = parent.get(k)
    if (p === undefined) {
      parent.set(k, k)
      return k
    }
    let root = p
    while (parent.get(root) !== root) root = parent.get(root) as string
    // path compression
    let cur = k
    while (parent.get(cur) !== root) {
      const nxt = parent.get(cur) as string
      parent.set(cur, root)
      cur = nxt
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const pinsFor = (c: CircuitComponentData, pinName: string): string =>
    `${c.id}:${pinName}`

  // register all pins
  for (const c of circuit.components) {
    const known = knownPins(c.type)
    for (const pin of known) {
      find(pinsFor(c, pin))
    }
  }
  // wires
  for (const w of circuit.wires) {
    find(pinsFor({ id: w.from.componentId } as CircuitComponentData, w.from.pin))
    find(pinsFor({ id: w.to.componentId } as CircuitComponentData, w.to.pin))
    union(
      pinsFor({ id: w.from.componentId } as CircuitComponentData, w.from.pin),
      pinsFor({ id: w.to.componentId } as CircuitComponentData, w.to.pin),
    )
  }

  // --- choose reference (ground) set ---
  const groundComps = circuit.components.filter((c) => c.type === 'ground')
  let refRoot: string | undefined
  for (const g of groundComps) {
    const r = find(pinsFor(g, 'G'))
    if (refRoot === undefined) refRoot = r
    else union(refRoot, r)
  }
  if (refRoot === undefined) {
    const bat = circuit.components.find((c) => c.type === 'battery')
    if (bat) refRoot = find(pinsFor(bat, '-'))
    else if (circuit.components.length > 0) {
      const c0 = circuit.components[0]
      const ks = knownPins(c0.type)
      refRoot = ks.length > 0 ? find(pinsFor(c0, ks[0])) : undefined
    }
  }

  // --- renumber nodes ---
  const rootToNode = new Map<string, number>()
  let next = 1
  const nodeOf = (pinKey: string): number => {
    const r = find(pinKey)
    if (refRoot !== undefined && r === refRoot) return 0
    return getOrCreate(rootToNode, r, () => next++)
  }
  const internalNode = (): number => next++

  const comps: CompiledComponent[] = []
  let vsCount = 0
  for (const c of circuit.components) {
    const pinNodes = new Map<string, number>()
    for (const pin of knownPins(c.type)) pinNodes.set(pin, nodeOf(pinsFor(c, pin)))
    let nodeM = -1
    let vsIndex = -1
    if (c.type === 'battery' || c.type === 'gate' || c.type === 'motor' || c.type === 'fan' ||
      c.type === 'clock' || c.type === 'opAmp') {
      nodeM = internalNode()
      vsIndex = vsCount++
    }
    const cc: CompiledComponent = { data: c, pinNodes, nodeM, vsIndex }
    comps.push(cc)
    compById.set(c.id, cc)
  }

  return {
    circuit,
    nodeCount: next,
    vsCount,
    comps,
    compById,
    wires: circuit.wires,
    nl: new Map(),
    transient: new Map(),
    lastNow: null,
    protection: new Map(),
    blownFuses: new Set(),
  }
}

export function knownPins(type: CircuitComponentData['type']): string[] {
  return COMPONENT_DEFS[type]?.pins.map((pin) => pin.name) ?? []
}

// ---------------------------------------------------------------------------
// Solving
// ---------------------------------------------------------------------------

export interface SolveInputs {
  /** Component id -> rotor angular velocity (rad/s, signed CCW-positive). */
  motorW: Map<string, number>
  /** Wall-clock ms (for protection retry timing). */
  now: number
}

function buildMatrix(n: number): { A: Float64Array[]; rhs: Float64Array } {
  const A: Float64Array[] = []
  for (let i = 0; i < n; i++) A.push(new Float64Array(n))
  return { A, rhs: new Float64Array(n) }
}

function stampResistor(A: Float64Array[], a: number, b: number, G: number, nodeCount: number) {
  if (G === 0) return
  const ia = a === 0 ? -1 : a - 1
  const ib = b === 0 ? -1 : b - 1
  if (ia >= 0) A[ia][ia] += G
  if (ib >= 0) A[ib][ib] += G
  if (ia >= 0 && ib >= 0) {
    A[ia][ib] -= G
    A[ib][ia] -= G
  }
}

function stampSource(
  A: Float64Array[],
  rhs: Float64Array,
  p: number,
  n: number,
  V: number,
  vi: number,
  nodeCount: number,
) {
  const row = nodeCount - 1 + vi
  const ip = p === 0 ? -1 : p - 1
  const in_ = n === 0 ? -1 : n - 1
  if (ip >= 0) {
    A[row][ip] += 1
    A[ip][row] += 1
  }
  if (in_ >= 0) {
    A[row][in_] -= 1
    A[in_][row] -= 1
  }
  rhs[row] = V
}

/**
 * Current source: injects current I (amps) INTO node a, OUT of node b.
 * (KCL rows hold currents leaving the node, so rhs[a] += I, rhs[b] -= I.)
 */
function stampCurrent(rhs: Float64Array, a: number, b: number, I: number, nodeCount: number) {
  void nodeCount
  if (a !== 0) rhs[a - 1] += I
  if (b !== 0) rhs[b - 1] -= I
}

function solveLinear(A: Float64Array[], rhs: Float64Array): Float64Array | null {
  const n = A.length
  const M = A.map((row) => Float64Array.from(row))
  const b = Float64Array.from(rhs)
  for (let col = 0; col < n; col++) {
    // partial pivot
    let piv = col
    let best = Math.abs(M[col][col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col])
      if (v > best) {
        best = v
        piv = r
      }
    }
    if (best < 1e-14) return null
    if (piv !== col) {
      const t = M[col]
      M[col] = M[piv]
      M[piv] = t
      const tb = b[col]
      b[col] = b[piv]
      b[piv] = tb
    }
    const diag = M[col][col]
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / diag
      if (f === 0) continue
      const row = M[r]
      const prow = M[col]
      for (let c = col; c < n; c++) row[c] -= f * prow[c]
      b[r] -= f * b[col]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    const row = M[r]
    for (let c = r + 1; c < n; c++) s -= row[c] * x[c]
    x[r] = s / M[r][r]
  }
  return x
}

interface ElementStamp {
  R: { a: number; b: number; G: number }[]
  V: { p: number; n: number; V: number; vi: number }[]
}

function gateCompute(gateType: string, in1High: boolean, in2High: boolean): boolean {
  switch (gateType) {
    case 'AND':
      return in1High && in2High
    case 'NAND':
      return !(in1High && in2High)
    case 'OR':
      return in1High || in2High
    case 'NOR':
      return !(in1High || in2High)
    case 'XOR':
      return in1High !== in2High
    case 'XNOR':
      return in1High === in2High
    case 'NOT':
      return !in1High
    default:
      return false
  }
}

export function evaluateGate(gateType: string, v1: number, v2: number): boolean {
  return gateCompute(gateType, v1 >= LOGIC_THRESHOLD_V, v2 >= LOGIC_THRESHOLD_V)
}

function nlState(
  net: CompiledNetwork,
  id: string,
): { on: boolean; R: number; flips: number; mode?: 'off' | 'forward' | 'reverse' } {
  let s = net.nl.get(id)
  if (!s) {
    s = { on: false, R: R_OFF, flips: 0 }
    net.nl.set(id, s)
  }
  return s
}

function transientState(net: CompiledNetwork, data: CircuitComponentData): TransientState {
  let state = net.transient.get(data.id)
  if (!state) {
    state = {
      voltage: boundedProp(data.props, 'initialVoltage', 0, -MAX_STATE, MAX_STATE),
      current: boundedProp(data.props, 'initialCurrent', 0, -MAX_STATE, MAX_STATE),
    }
    net.transient.set(data.id, state)
  }
  return state
}

function forwardVoltage(data: CircuitComponentData): number {
  const fallback = data.type === 'led' ? 2 : data.type === 'rgbLed' ? 2.2 : data.type === 'schottky' ? 0.3 : 0.7
  return boundedProp(data.props, 'forwardVoltage', fallback, 0, 100)
}

function finiteState(value: number, fallback = 0): number {
  return Number.isFinite(value) ? clamp(value, -MAX_STATE, MAX_STATE) : fallback
}

function commitTransient(net: CompiledNetwork, nodeV: Float64Array, dt: number): void {
  const voltage = (node: number): number => node === 0 ? 0 : nodeV[node]
  for (const cc of net.comps) {
    if (cc.data.type !== 'capacitor' && cc.data.type !== 'inductor') continue
    const state = transientState(net, cc.data)
    const a = voltage(cc.pinNodes.get('A') ?? 0)
    const b = voltage(cc.pinNodes.get('B') ?? 0)
    const v = a - b
    if (cc.data.type === 'capacitor') {
      const capacitance = boundedProp(cc.data.props, 'capacitance', 0.001, 1e-12, 1000)
      const current = capacitance * (v - state.voltage) / dt
      state.voltage = finiteState(v, state.voltage)
      state.current = finiteState(current)
    } else {
      const inductance = boundedProp(cc.data.props, 'inductance', 0.1, 1e-9, 1000)
      const current = state.current + v * dt / inductance
      state.voltage = finiteState(v, state.voltage)
      state.current = finiteState(current)
    }
  }
}

export function solveCircuit(net: CompiledNetwork, inputs: SolveInputs): CircuitRuntime {
  const { nodeCount, vsCount } = net
  const n = nodeCount - 1 + vsCount
  const nodeV = new Float64Array(nodeCount) // node 0 = 0
  const srcI = new Float64Array(Math.max(1, vsCount))

  const pinVoltages = new Map<string, Map<string, number>>()
  const states = new Map<string, ComponentRuntimeState>()
  const wires = new Map<string, { current: number; vA: number; vB: number; overloaded: boolean }>()
  const warnings: string[] = []

  const getV = (node: number): number => (node === 0 ? 0 : nodeV[node])

  const motorW = inputs.motorW
  const now = inputs.now
  const dt = transientTimeStep(net.lastNow, now)
  for (const cc of net.comps) {
    if (cc.data.type === 'capacitor' || cc.data.type === 'inductor') transientState(net, cc.data)
  }

  // --- protection retry: batteries whose cooldown elapsed get re-armed ---
  for (const cc of net.comps) {
    if (cc.data.type !== 'battery') continue
    const p = net.protection.get(cc.data.id)
    if (p && p.tripped && now >= p.retryAt) {
      p.tripped = false
    }
  }

  let solution: Float64Array | null = null

  // --- dynamic stamp: depends on evolving nonlinear states -> iterate ---
  const gateOut = new Map<string, number>()
  const opAmpOut = new Map<string, number>()
  let changed = true
  let iter = 0
  while (changed && iter < MAX_ITER) {
    changed = false
    iter++
    const { A, rhs } = buildMatrix(n)

    // leakage: every non-reference node to ground
    for (let k = 1; k < nodeCount; k++) A[k - 1][k - 1] += LEAK_G

    solution = stampAndSolve(net, A, rhs, gateOut, opAmpOut, nodeV, srcI, motorW, now, dt)
    if (!solution) break
    fillVoltages(nodeV, solution, nodeCount)
    // update nonlinear states from solved voltages
    for (const cc of net.comps) {
      const d = cc.data
      const st = nlState(net, d.id)
      const pn = (pin: string): number => getV(cc.pinNodes.get(pin) ?? 0)
      if (d.type === 'diode' || d.type === 'led' || d.type === 'schottky') {
        const vf = forwardVoltage(d)
        const vak = pn('A') - pn('K')
        const want = vak > vf * 0.98
        if (want !== st.on) {
          st.flips++
          if (st.flips > 8) {
            // Bistable corner: freeze in the conducting pattern (preferred).
            st.on = true
          } else {
            changed = true
            st.on = want
            st.R = want ? DIODE_RD : R_OFF
          }
        }
      } else if (d.type === 'rgbLed') {
        for (const channel of ['R', 'G', 'B'] as const) {
          const channelState = nlState(net, `${d.id}:${channel}`)
          const vf = forwardVoltage(d)
          const want = pn(channel) - pn('K') > vf * 0.98
          if (want === channelState.on) continue
          channelState.flips++
          if (channelState.flips > 8) {
            channelState.on = true
          } else {
            channelState.on = want
            channelState.R = want ? DIODE_RD : R_OFF
            changed = true
          }
        }
      } else if (d.type === 'zenerDiode') {
        const vak = pn('A') - pn('K')
        const vf = forwardVoltage(d)
        const vz = boundedProp(d.props, 'zenerVoltage', 5.1, 0.1, 1000)
        const want = vak > vf * 0.98 ? 'forward' : vak < -vz * 0.98 ? 'reverse' : 'off'
        const previous = st.mode ?? 'off'
        if (want !== previous) {
          st.flips++
          st.mode = want
          st.on = want !== 'off'
          st.R = st.on ? DIODE_RD : R_OFF
          if (st.flips <= 8) changed = true
        }
      } else if (d.type === 'transistor') {
        const kind = d.props.transistorKind === 'PNP' ? 'PNP' : 'NPN'
        const vb = pn('B')
        const ve = pn('E')
        const want = kind === 'NPN' ? vb - ve > 0.6 : ve - vb > 0.6
        if (want !== st.on) {
          changed = true
          st.on = want
        }
      } else if (d.type === 'mosfet') {
        const threshold = boundedProp(d.props, 'thresholdVoltage', 2, 0, 100)
        const vgs = pn('G') - pn('S')
        const want = d.props.mosfetKind === 'P' ? vgs < -threshold : vgs > threshold
        if (want !== st.on) {
          st.on = want
          st.R = want ? boundedProp(d.props, 'rdsOn', 0.05, 1e-6, 1e6) : R_OFF
          changed = true
        }
      } else if (d.type === 'relay') {
        const pickup = boundedProp(d.props, 'pickupVoltage', 5, 0, 1000)
        const want = Math.abs(pn('A') - pn('B')) >= pickup
        if (want !== st.on) {
          st.on = want
          changed = true
        }
      } else if (d.type === 'gate') {
        const gt = d.props.gateType ?? 'AND'
        const v1 = pn('IN1')
        const v2 = gateHasSecondInput(gt) ? pn('IN2') : 0
        const out = evaluateGate(gt, v1, v2) ? 1 : 0
        if (gateOut.get(d.id) !== out) {
          gateOut.set(d.id, out)
          changed = true
        }
      } else if (d.type === 'opAmp') {
        const desired = opAmpTarget(d.props, pn('IN+'), pn('IN-'), pn('V+'), pn('V-'))
        const previous = opAmpOut.get(d.id)
        const next = previous === undefined ? desired : previous + (desired - previous) * 0.5
        if (previous === undefined || Math.abs(next - previous) > 1e-5) changed = true
        opAmpOut.set(d.id, next)
      }
    }
  }

  if (!solution) {
    // Degenerate network — report zeros rather than crashing.
    return { pinVoltages, wires, states, solved: false, warnings: ['Solver fault: singular matrix'] }
  }

  const converged = !changed
  if (!converged) warnings.push(`Nonlinear solver did not converge after ${MAX_ITER} iterations`)

  // --- final extraction ---
  const x = solution
  fillVoltages(nodeV, x, nodeCount)
  for (let s = 0; s < vsCount; s++) srcI[s] = x[nodeCount - 1 + s] ?? 0
  if (converged) {
    commitTransient(net, nodeV, dt)
    net.lastNow = Number.isFinite(now) ? now : null
  }

  // pin voltage map
  for (const cc of net.comps) {
    const m = new Map<string, number>()
    for (const [pin, node] of cc.pinNodes) m.set(pin, getV(node))
    pinVoltages.set(cc.data.id, m)
  }

  const WIRE_OVERLOAD = 8 // amps; wire turns red beyond this
  for (const cc of net.comps) {
    const d = cc.data
    const p = d.props
    const pn = (pin: string): number => cc.pinNodes.get(pin) ?? 0
    const st: ComponentRuntimeState = { active: 0 }
    switch (d.type) {
      case 'battery': {
        const isrc = cc.vsIndex >= 0 ? srcI[cc.vsIndex] : 0
        const deliver = -isrc
        const prot = net.protection.get(d.id)
        st.current = deliver
        st.tripped = prot?.tripped ?? false
        st.voltage = prop(p, 'voltage', 9)
        st.active = prot?.tripped ? 0 : 1
        st.overloaded = Math.abs(deliver) > prop(p, 'maxCurrent', 8)
        break
      }
      case 'resistor':
        st.active = 0
        break
      case 'capacitor':
      case 'inductor': {
        const history = transientState(net, d)
        st.voltage = history.voltage
        st.current = history.current
        st.active = 0
        break
      }
      case 'diode':
      case 'schottky':
      case 'led': {
        const s = nlState(net, d.id)
        const vf = forwardVoltage(d)
        const vak = getV(pn('A')) - getV(pn('K'))
        const I = s.on ? Math.max(0, (vak - vf) / DIODE_RD) : vak / R_OFF
        st.on = s.on
        st.current = I
        st.voltage = vak
        if (d.type === 'led') {
          const bright = Math.max(0, Math.min(1, (I - 0.002) / 0.018))
          st.brightness = bright
          st.active = bright
        } else {
          st.active = s.on ? 1 : 0
        }
        break
      }
      case 'zenerDiode': {
        const s = nlState(net, d.id)
        const mode = s.mode ?? 'off'
        const vak = getV(pn('A')) - getV(pn('K'))
        const vf = forwardVoltage(d)
        const vz = boundedProp(p, 'zenerVoltage', 5.1, 0.1, 1000)
        const I = mode === 'forward' ? Math.max(0, (vak - vf) / DIODE_RD) :
          mode === 'reverse' ? Math.min(0, (vak + vz) / DIODE_RD) : vak / R_OFF
        st.on = mode !== 'off'
        st.reverseBreakdown = mode === 'reverse'
        st.current = I
        st.voltage = vak
        st.active = mode !== 'off' ? 1 : 0
        break
      }
      case 'rgbLed': {
        const vf = forwardVoltage(d)
        const channels = { R: 0, G: 0, B: 0 }
        let total = 0
        let voltage = 0
        for (const channel of ['R', 'G', 'B'] as const) {
          const s = nlState(net, `${d.id}:${channel}`)
          const v = getV(pn(channel)) - getV(pn('K'))
          const I = s.on ? Math.max(0, (v - vf) / DIODE_RD) : v / R_OFF
          channels[channel] = clamp((I - 0.002) / 0.018, 0, 1)
          total += I
          voltage = Math.max(voltage, v)
        }
        const brightness = Math.max(channels.R, channels.G, channels.B)
        st.channels = channels
        st.current = total
        st.voltage = voltage
        st.brightness = brightness
        st.active = brightness
        st.on = brightness > 0
        break
      }
      case 'switchPush':
      case 'switchSlide': {
        const closed = p.closed === true
        st.closed = closed
        st.active = closed ? 1 : 0
        break
      }
      case 'potentiometer':
        st.position = prop(p, 'position', 0.5)
        st.active = 0
        break
      case 'photoresistor':
      case 'thermistor': {
        const R = d.type === 'photoresistor' ? photoresistorResistance(p) : thermistorResistance(p)
        const V = getV(pn('A')) - getV(pn('B'))
        st.voltage = V
        st.current = V / R
        st.resistance = R
        st.active = d.type === 'photoresistor' ? boundedProp(p, 'lightLevel', 0.5, 0, 1) : 0
        if (d.type === 'photoresistor') st.lightLevel = boundedProp(p, 'lightLevel', 0.5, 0, 1)
        else st.temperature = prop(p, 'temperature', 25)
        break
      }
      case 'incandescent':
      case 'solenoid':
      case 'speaker': {
        const fallbackR = d.type === 'incandescent' ? 24 : d.type === 'solenoid' ? 12 : 8
        const R = boundedProp(p, 'resistance', fallbackR, 1e-6, 1e12)
        const V = getV(pn('+')) - getV(pn('-'))
        const I = V / R
        const power = Math.abs(V * I)
        st.voltage = V
        st.current = I
        st.power = power
        if (d.type === 'incandescent') {
          const brightness = incandescentBrightness(V, I, prop(p, 'ratedPower', 12))
          st.brightness = brightness
          st.active = brightness
          st.on = brightness > 0.01
          st.overloaded = Math.abs(I) > prop(p, 'maxCurrent', 2)
        } else if (d.type === 'solenoid') {
          const pickup = boundedProp(p, 'pickupVoltage', 3, 0, 1000)
          st.on = Math.abs(V) >= pickup
          st.active = pickup > 0 ? clamp(Math.abs(V) / pickup, 0, 1) : 1
          st.overloaded = Math.abs(I) > prop(p, 'maxCurrent', 2) || power > prop(p, 'ratedPower', 12)
        } else {
          st.frequency = prop(p, 'frequency', 440)
          st.on = Math.abs(V) > 1.5
          st.active = st.on ? Math.min(1, Math.abs(V) / 9) : 0
          st.overloaded = power > prop(p, 'ratedPower', 1) * 1.5
        }
        break
      }
      case 'relay': {
        const s = nlState(net, d.id)
        const R = boundedProp(p, 'resistance', 200, 1e-6, 1e12)
        const V = getV(pn('A')) - getV(pn('B'))
        st.current = V / R
        st.voltage = V
        st.on = s.on
        st.closed = s.on
        st.active = s.on ? 1 : 0
        const noCurrent = (getV(pn('COM')) - getV(pn('NO'))) / (s.on ? R_ON_SWITCH : R_OFF)
        const ncCurrent = (getV(pn('COM')) - getV(pn('NC'))) / (s.on ? R_OFF : R_ON_SWITCH)
        st.overloaded = Math.max(Math.abs(noCurrent), Math.abs(ncCurrent)) > prop(p, 'maxCurrent', 5)
        break
      }
      case 'mosfet': {
        const s = nlState(net, d.id)
        const R = s.on ? boundedProp(p, 'rdsOn', 0.05, 1e-6, 1e6) : R_OFF
        const V = getV(pn('D')) - getV(pn('S'))
        st.voltage = V
        st.current = V / R
        st.on = s.on
        st.active = s.on ? 1 : 0
        break
      }
      case 'currentSource': {
        const I = boundedProp(p, 'current', 0.01, -100, 100)
        st.current = I
        st.voltage = getV(pn('A')) - getV(pn('B'))
        st.on = I !== 0
        st.active = I === 0 ? 0 : 1
        break
      }
      case 'clock': {
        const isrc = cc.vsIndex >= 0 ? srcI[cc.vsIndex] : 0
        const V = getV(pn('OUT')) - getV(pn('GND'))
        const high = clockVoltage(p, now) !== 0
        st.out = high ? 1 : 0
        st.on = high
        st.active = high ? 1 : 0
        st.voltage = V
        st.current = -isrc
        st.frequency = prop(p, 'frequency', 1)
        st.overloaded = Math.abs(isrc) > prop(p, 'maxCurrent', 0.25)
        break
      }
      case 'opAmp': {
        const isrc = cc.vsIndex >= 0 ? srcI[cc.vsIndex] : 0
        const out = getV(pn('OUT'))
        const low = Math.min(getV(pn('V+')), getV(pn('V-')))
        const high = Math.max(getV(pn('V+')), getV(pn('V-')))
        st.out = out
        st.voltage = out - getV(pn('V-'))
        st.current = -isrc
        st.active = high > low ? clamp((out - low) / (high - low), 0, 1) : 0
        st.on = Math.abs(isrc) > 1e-9
        st.overloaded = Math.abs(isrc) > prop(p, 'maxCurrent', 0.25)
        break
      }
      case 'motor':
      case 'fan': {
        const fallbackR = d.type === 'fan' ? 4 : 2
        const I = (getV(pn('+')) - getV(cc.nodeM)) / boundedProp(p, 'resistance', fallbackR, 1e-6, 1e12)
        const driveV = getV(pn('+')) - getV(pn('-'))
        st.current = I
        st.voltage = driveV
        st.angularVelocity = motorW.get(d.id) ?? 0
        st.active = Math.abs(driveV) > 0.2 ? 1 : 0
        st.overloaded = Math.abs(I) > prop(p, 'maxCurrent', d.type === 'fan' ? 3 : 10)
        break
      }
      case 'buzzer': {
        const V = getV(pn('+')) - getV(pn('-'))
        st.voltage = V
        st.frequency = prop(p, 'frequency', 440)
        const on = Math.abs(V) > 1.5
        st.on = on
        st.active = on ? Math.min(1, Math.abs(V) / 9) : 0
        st.current = V / Math.max(prop(p, 'resistance', 100), 1e-6)
        break
      }
      case 'gate': {
        const out = gateOut.get(d.id) ?? 0
        st.out = out
        st.active = out
        st.gateType = (d.props.gateType ?? 'AND') as ComponentRuntimeState['gateType']
        break
      }
      case 'transistor': {
        const s = nlState(net, d.id)
        st.on = s.on
        st.active = s.on ? 1 : 0
        st.voltage = getV(pn('C')) - getV(pn('E'))
        st.current = s.on ? st.voltage / Math.max(prop(p, 'rce', 2), 1e-6) : 0
        break
      }
      case 'fuse': {
        const blown = net.blownFuses.has(d.id) || p.blown === true
        const R = blown ? R_OFF : R_FUSE
        st.voltage = getV(pn('A')) - getV(pn('B'))
        st.current = st.voltage / R
        st.blown = blown
        st.overloaded = Math.abs(st.current) > prop(p, 'maxCurrent', 1)
        st.active = 0
        break
      }
      case 'ground':
        st.active = 0
        break
      default:
        break
    }
    states.set(d.id, st)
  }

  // pin-out currents for wires
  const pinOut = new Map<string, number>() // compId:pin -> amps leaving the pin
  for (const cc of net.comps) {
    const d = cc.data
    const p = d.props
    const pn = (pin: string): number => getV(cc.pinNodes.get(pin) ?? 0)
    const set = (pin: string, I: number) => pinOut.set(`${d.id}:${pin}`, I)
    const pair = (a: string, b: string, enteringA: number) => {
      set(a, -enteringA)
      set(b, enteringA)
    }
    switch (d.type) {
      case 'battery': {
        const deliver = states.get(d.id)?.current ?? 0
        set('+', deliver)
        set('-', -deliver)
        break
      }
      case 'resistor':
      case 'buzzer':
      case 'speaker':
      case 'incandescent':
      case 'solenoid':
      case 'photoresistor':
      case 'thermistor': {
        const twoLetter = d.type === 'resistor' || d.type === 'photoresistor' || d.type === 'thermistor'
        const a = twoLetter ? 'A' : '+'
        const b = twoLetter ? 'B' : '-'
        const fallback = d.type === 'resistor' ? 220 : d.type === 'buzzer' ? 100 : d.type === 'speaker' ? 8 :
          d.type === 'incandescent' ? 24 : d.type === 'solenoid' ? 12 : 1000
        const R = d.type === 'photoresistor' ? photoresistorResistance(p) : d.type === 'thermistor' ? thermistorResistance(p) :
          boundedProp(p, 'resistance', fallback, 1e-6, 1e12)
        pair(a, b, (pn(a) - pn(b)) / R)
        break
      }
      case 'capacitor':
      case 'inductor':
        pair('A', 'B', transientState(net, d).current)
        break
      case 'diode':
      case 'schottky':
      case 'led':
      case 'zenerDiode':
        pair('A', 'K', states.get(d.id)?.current ?? 0)
        break
      case 'rgbLed': {
        const vf = forwardVoltage(d)
        let total = 0
        for (const channel of ['R', 'G', 'B'] as const) {
          const s = nlState(net, `${d.id}:${channel}`)
          const v = pn(channel) - pn('K')
          const I = s.on ? Math.max(0, (v - vf) / DIODE_RD) : v / R_OFF
          set(channel, -I)
          total += I
        }
        set('K', total)
        break
      }
      case 'switchPush':
      case 'switchSlide':
      case 'fuse': {
        const R = d.type === 'fuse' && (net.blownFuses.has(d.id) || p.blown === true) ? R_OFF :
          d.type === 'fuse' ? R_FUSE : p.closed === true ? R_ON_SWITCH : R_OFF
        pair('A', 'B', (pn('A') - pn('B')) / Math.max(R, 1e-9))
        break
      }
      case 'potentiometer': {
        const R = Math.max(prop(p, 'resistance', 10000), 1e-3)
        const pos = Math.min(1, Math.max(0, prop(p, 'position', 0.5)))
        const Ra = Math.max(R * pos, 1e-4)
        const Rb = Math.max(R * (1 - pos), 1e-4)
        const IA = (pn('A') - pn('W')) / Ra
        const IB = (pn('B') - pn('W')) / Rb
        set('A', -IA)
        set('B', -IB)
        set('W', IA + IB)
        break
      }
      case 'relay': {
        const R = boundedProp(p, 'resistance', 200, 1e-6, 1e12)
        pair('A', 'B', (pn('A') - pn('B')) / R)
        const energized = nlState(net, d.id).on
        const rNo = energized ? R_ON_SWITCH : R_OFF
        const rNc = energized ? R_OFF : R_ON_SWITCH
        const ino = (pn('COM') - pn('NO')) / rNo
        const inc = (pn('COM') - pn('NC')) / rNc
        set('COM', -(ino + inc))
        set('NO', ino)
        set('NC', inc)
        break
      }
      case 'mosfet': {
        const s = nlState(net, d.id)
        const R = s.on ? boundedProp(p, 'rdsOn', 0.05, 1e-6, 1e6) : R_OFF
        pair('D', 'S', (pn('D') - pn('S')) / R)
        set('G', 0)
        break
      }
      case 'currentSource': {
        const I = boundedProp(p, 'current', 0.01, -100, 100)
        const leakage = (pn('A') - pn('B')) / R_OFF
        set('A', I - leakage)
        set('B', -I + leakage)
        break
      }
      case 'motor':
      case 'fan': {
        const R = boundedProp(p, 'resistance', d.type === 'fan' ? 4 : 2, 1e-6, 1e12)
        pair('+', '-', (pn('+') - getV(cc.nodeM)) / R)
        break
      }
      case 'gate': {
        const isrc = cc.vsIndex >= 0 ? srcI[cc.vsIndex] : 0
        set('OUT', -isrc)
        set('IN1', 0)
        set('IN2', 0)
        break
      }
      case 'clock': {
        const isrc = cc.vsIndex >= 0 ? srcI[cc.vsIndex] : 0
        set('OUT', -isrc)
        set('GND', isrc)
        break
      }
      case 'opAmp': {
        const isrc = cc.vsIndex >= 0 ? srcI[cc.vsIndex] : 0
        set('OUT', -isrc)
        set('IN+', 0)
        set('IN-', 0)
        set('V+', 0)
        set('V-', isrc)
        break
      }
      case 'transistor': {
        const s = nlState(net, d.id)
        const rce = Math.max(prop(p, 'rce', 2), 1e-6)
        const IC = s.on ? (pn('C') - pn('E')) / rce : 0
        const IB = s.on ? (pn('B') - pn('E')) / 50 : 0
        set('C', -IC)
        set('E', IC + IB)
        set('B', -IB)
        break
      }
      case 'ground':
        set('G', 0)
        break
      default:
        break
    }
  }

  for (const w of net.wires) {
    const ia = pinOut.get(`${w.from.componentId}:${w.from.pin}`) ?? 0
    const ib = pinOut.get(`${w.to.componentId}:${w.to.pin}`) ?? 0
    const current = (ia - ib) / 2
    const va = pinVoltages.get(w.from.componentId)?.get(w.from.pin) ?? 0
    const vb = pinVoltages.get(w.to.componentId)?.get(w.to.pin) ?? 0
    wires.set(w.id, {
      current,
      vA: va,
      vB: vb,
      overloaded: Math.abs(current) > WIRE_OVERLOAD,
    })
  }

  return { pinVoltages, wires, states, solved: converged, warnings }
}

function fillVoltages(nodeV: Float64Array, x: Float64Array, nodeCount: number) {
  for (let k = 1; k < nodeCount; k++) nodeV[k] = x[k - 1]
}

/**
 * Stamps all dynamic elements, solves, and returns the solution vector.
 * Nonlinear element states (diodes / transistors / gates) are read from the
 * network's persistent state, which the outer loop converges.
 */
function stampAndSolve(
  net: CompiledNetwork,
  A: Float64Array[],
  rhs: Float64Array,
  gateOut: Map<string, number>,
  opAmpOut: Map<string, number>,
  nodeV: Float64Array,
  srcI: Float64Array,
  motorW: Map<string, number>,
  now: number,
  dt: number,
): Float64Array | null {
  const { nodeCount } = net
  for (const cc of net.comps) {
    const d = cc.data
    const p = d.props
    const node = (pin: string): number => cc.pinNodes.get(pin) ?? 0
    switch (d.type) {
      case 'ground':
        break
      case 'resistor': {
        const R = Math.max(prop(p, 'resistance', 220), 1e-6)
        stampResistor(A, node('A'), node('B'), 1 / R, nodeCount)
        break
      }
      case 'capacitor': {
        const C = boundedProp(p, 'capacitance', 0.001, 1e-12, 1000)
        const G = C / dt
        const history = transientState(net, d)
        stampResistor(A, node('A'), node('B'), G, nodeCount)
        stampCurrent(rhs, node('A'), node('B'), G * history.voltage, nodeCount)
        break
      }
      case 'inductor': {
        const L = boundedProp(p, 'inductance', 0.1, 1e-9, 1000)
        const G = dt / L
        const history = transientState(net, d)
        stampResistor(A, node('A'), node('B'), G, nodeCount)
        stampCurrent(rhs, node('A'), node('B'), -history.current, nodeCount)
        break
      }
      case 'photoresistor':
      case 'thermistor': {
        const R = d.type === 'photoresistor' ? photoresistorResistance(p) : thermistorResistance(p)
        stampResistor(A, node('A'), node('B'), 1 / R, nodeCount)
        break
      }
      case 'buzzer':
      case 'speaker':
      case 'incandescent':
      case 'solenoid': {
        const fallback = d.type === 'buzzer' ? 100 : d.type === 'speaker' ? 8 : d.type === 'incandescent' ? 24 : 12
        const R = boundedProp(p, 'resistance', fallback, 1e-6, 1e12)
        stampResistor(A, node('+'), node('-'), 1 / R, nodeCount)
        break
      }
      case 'switchPush':
      case 'switchSlide': {
        const R = p.closed === true ? R_ON_SWITCH : R_OFF
        stampResistor(A, node('A'), node('B'), 1 / R, nodeCount)
        break
      }
      case 'fuse': {
        const R = net.blownFuses.has(d.id) || p.blown === true ? R_OFF : R_FUSE
        stampResistor(A, node('A'), node('B'), 1 / R, nodeCount)
        break
      }
      case 'diode':
      case 'schottky':
      case 'led': {
        // Norton equivalent: Rd in parallel with a Vf/Rd current injection,
        // exact for the on-pattern so iteration converges in 1-2 passes.
        const st = nlState(net, d.id)
        if (st.on) {
          const vf = forwardVoltage(d)
          stampResistor(A, node('A'), node('K'), 1 / DIODE_RD, nodeCount)
          stampCurrent(rhs, node('A'), node('K'), vf / DIODE_RD, nodeCount)
        } else {
          stampResistor(A, node('A'), node('K'), 1 / R_OFF, nodeCount)
        }
        break
      }
      case 'zenerDiode': {
        const st = nlState(net, d.id)
        const mode = st.mode ?? 'off'
        stampResistor(A, node('A'), node('K'), 1 / (mode === 'off' ? R_OFF : DIODE_RD), nodeCount)
        if (mode === 'forward') stampCurrent(rhs, node('A'), node('K'), forwardVoltage(d) / DIODE_RD, nodeCount)
        else if (mode === 'reverse') {
          const vz = boundedProp(p, 'zenerVoltage', 5.1, 0.1, 1000)
          stampCurrent(rhs, node('A'), node('K'), -vz / DIODE_RD, nodeCount)
        }
        break
      }
      case 'rgbLed': {
        const vf = forwardVoltage(d)
        for (const channel of ['R', 'G', 'B'] as const) {
          const st = nlState(net, `${d.id}:${channel}`)
          stampResistor(A, node(channel), node('K'), 1 / (st.on ? DIODE_RD : R_OFF), nodeCount)
          if (st.on) stampCurrent(rhs, node(channel), node('K'), vf / DIODE_RD, nodeCount)
        }
        break
      }
      case 'potentiometer': {
        const R = Math.max(prop(p, 'resistance', 10000), 1e-3)
        const pos = Math.min(1, Math.max(0, prop(p, 'position', 0.5)))
        stampResistor(A, node('A'), node('W'), 1 / Math.max(R * pos, 1e-4), nodeCount)
        stampResistor(A, node('W'), node('B'), 1 / Math.max(R * (1 - pos), 1e-4), nodeCount)
        break
      }
      case 'relay': {
        const R = boundedProp(p, 'resistance', 200, 1e-6, 1e12)
        const energized = nlState(net, d.id).on
        stampResistor(A, node('A'), node('B'), 1 / R, nodeCount)
        stampResistor(A, node('COM'), node('NO'), 1 / (energized ? R_ON_SWITCH : R_OFF), nodeCount)
        stampResistor(A, node('COM'), node('NC'), 1 / (energized ? R_OFF : R_ON_SWITCH), nodeCount)
        break
      }
      case 'mosfet': {
        const st = nlState(net, d.id)
        const R = st.on ? boundedProp(p, 'rdsOn', 0.05, 1e-6, 1e6) : R_OFF
        stampResistor(A, node('D'), node('S'), 1 / R, nodeCount)
        break
      }
      case 'currentSource': {
        const I = boundedProp(p, 'current', 0.01, -100, 100)
        stampResistor(A, node('A'), node('B'), 1 / R_OFF, nodeCount)
        stampCurrent(rhs, node('A'), node('B'), I, nodeCount)
        break
      }
      case 'transistor': {
        const st = nlState(net, d.id)
        if (st.on) {
          const rce = Math.max(prop(p, 'rce', 2), 1e-6)
          stampResistor(A, node('C'), node('E'), 1 / rce, nodeCount)
          stampResistor(A, node('B'), node('E'), 1 / 50, nodeCount)
        }
        break
      }
      case 'battery': {
        const prot = net.protection.get(d.id)
        const active = !(prot?.tripped)
        const V = active ? prop(p, 'voltage', 9) : 0
        stampResistor(A, node('+'), cc.nodeM, 1 / BATTERY_RINT, nodeCount)
        stampSource(A, rhs, cc.nodeM, node('-'), V, cc.vsIndex, nodeCount)
        break
      }
      case 'gate': {
        const out = gateOut.get(d.id) ?? 0
        stampResistor(A, node('OUT'), cc.nodeM, 1 / GATE_ROUT, nodeCount)
        stampSource(A, rhs, cc.nodeM, 0, out ? LOGIC_HIGH_V : 0, cc.vsIndex, nodeCount)
        break
      }
      case 'clock': {
        const R = boundedProp(p, 'outputResistance', 50, 1e-3, 1e9)
        stampResistor(A, node('OUT'), cc.nodeM, 1 / R, nodeCount)
        stampSource(A, rhs, cc.nodeM, node('GND'), clockVoltage(p, now), cc.vsIndex, nodeCount)
        break
      }
      case 'opAmp': {
        const R = boundedProp(p, 'outputResistance', 5, 1e-3, 1e9)
        const railMinusNode = node('V-')
        const railMinus = railMinusNode === 0 ? 0 : nodeV[railMinusNode]
        const target = opAmpOut.get(d.id) ?? 0
        stampResistor(A, node('OUT'), cc.nodeM, 1 / R, nodeCount)
        stampSource(A, rhs, cc.nodeM, railMinusNode, target - railMinus, cc.vsIndex, nodeCount)
        break
      }
      case 'motor':
      case 'fan': {
        const R = boundedProp(p, 'resistance', d.type === 'fan' ? 4 : 2, 1e-6, 1e12)
        const ke = boundedProp(p, 'ke', d.type === 'fan' ? 0.5 : 1, -1000, 1000)
        const w = finiteState(motorW.get(d.id) ?? 0)
        stampResistor(A, node('+'), cc.nodeM, 1 / R, nodeCount)
        // Back-EMF source E = ke * w between internal node (m) and '-' terminal.
        stampSource(A, rhs, cc.nodeM, node('-'), ke * w, cc.vsIndex, nodeCount)
        break
      }
      default:
        break
    }
  }
  return solveLinear(A, rhs)
}

/** Post-solve protection: trip batteries that exceed their current rating. */
export function applyProtection(net: CompiledNetwork, runtime: CircuitRuntime, now: number): void {
  if (!runtime.solved) return
  for (const cc of net.comps) {
    if (cc.data.type !== 'battery' && cc.data.type !== 'fuse') continue
    const st = runtime.states.get(cc.data.id)
    if (!st) continue
    if (cc.data.type === 'fuse') {
      const limit = prop(cc.data.props, 'maxCurrent', 1)
      if (!st.blown && Math.abs(st.current ?? 0) > limit) {
        net.blownFuses.add(cc.data.id)
        cc.data.props.blown = true
        runtime.states.set(cc.data.id, { ...st, blown: true, overloaded: true, active: 0 })
      }
      continue
    }
    const limit = prop(cc.data.props, 'maxCurrent', 8)
    if (st.overloaded && !st.tripped && Math.abs(st.current ?? 0) > limit) {
      net.protection.set(cc.data.id, { tripped: true, retryAt: now + 800 })
      runtime.states.set(cc.data.id, { ...st, tripped: true, active: 0 })
    }
  }
}

export { GATE_LABELS }
