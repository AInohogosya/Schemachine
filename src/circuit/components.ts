// ============================================================================
// Circuit component catalog: pin layout, defaults, electrical orientation.
// Pin offsets are in schematic units relative to component center.
// `dir` is the outward direction the wire stub leaves the component.
// ============================================================================

import type { CircuitComponentType, CircuitProps } from '../types'

export interface PinDef {
  name: string
  x: number
  y: number
  dir: 'up' | 'down' | 'left' | 'right'
  role: 'passive' | 'positive' | 'negative' | 'input' | 'output' | 'base' | 'collector' | 'emitter'
}

export interface ComponentDef {
  label: string
  category: 'power' | 'passive' | 'inputs' | 'outputs' | 'semiconductors' | 'logic'
  pins: PinDef[]
  defaults: () => CircuitProps
  symbolSize: { w: number; h: number }
  description: string
  keywords: string[]
}

const P = (name: string, x: number, y: number, dir: PinDef['dir'], role: PinDef['role']): PinDef => ({
  name, x, y, dir, role,
})

export const COMPONENT_DEFS: Record<CircuitComponentType, ComponentDef> = {
  battery: {
    label: 'Power Supply',
    category: 'power',
    symbolSize: { w: 60, h: 60 },
    pins: [P('+', 0, -30, 'up', 'positive'), P('-', 0, 30, 'down', 'negative')],
    defaults: () => ({ voltage: 9, maxCurrent: 8 }),
    description: 'DC voltage supply with internal resistance and overcurrent protection.',
    keywords: ['battery', 'dc', 'voltage', 'power', 'supply'],
  },
  ground: {
    label: 'Ground',
    category: 'power',
    symbolSize: { w: 40, h: 40 },
    pins: [P('G', 0, -20, 'up', 'negative')],
    defaults: () => ({}),
    description: 'Zero-volt reference node for the schematic.',
    keywords: ['ground', 'gnd', 'reference', 'earth', 'power'],
  },
  resistor: {
    label: 'Resistor',
    category: 'passive',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ resistance: 220 }),
    description: 'Linear two-terminal resistance.',
    keywords: ['resistor', 'resistance', 'ohms', 'passive'],
  },
  diode: {
    label: 'Diode',
    category: 'semiconductors',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('K', 0, 30, 'down', 'passive')],
    defaults: () => ({ forwardVoltage: 0.7 }),
    description: 'Silicon PN diode with forward conduction and reverse blocking.',
    keywords: ['diode', 'silicon', 'rectifier', 'semiconductor'],
  },
  led: {
    label: 'LED',
    category: 'outputs',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('K', 0, 30, 'down', 'passive')],
    defaults: () => ({ forwardVoltage: 2.0, color: 'red' }),
    description: 'Light-emitting diode with current-dependent brightness.',
    keywords: ['led', 'light', 'lamp', 'diode', 'output'],
  },
  switchPush: {
    label: 'Push Button',
    category: 'inputs',
    symbolSize: { w: 60, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ closed: false }),
    description: 'Momentary user-controlled contact.',
    keywords: ['button', 'push', 'momentary', 'switch', 'input'],
  },
  switchSlide: {
    label: 'Slide Switch',
    category: 'inputs',
    symbolSize: { w: 60, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ closed: false }),
    description: 'Latching user-controlled contact.',
    keywords: ['switch', 'slide', 'toggle', 'input'],
  },
  potentiometer: {
    label: 'Potentiometer',
    category: 'inputs',
    symbolSize: { w: 60, h: 60 },
    pins: [
      P('A', -30, 30, 'down', 'passive'),
      P('W', 0, -30, 'up', 'passive'),
      P('B', 30, 30, 'down', 'passive'),
    ],
    defaults: () => ({ resistance: 10000, position: 0.5 }),
    description: 'Adjustable voltage divider with a moving wiper.',
    keywords: ['potentiometer', 'pot', 'wiper', 'divider', 'input'],
  },
  motor: {
    label: 'DC Motor',
    category: 'outputs',
    symbolSize: { w: 64, h: 64 },
    pins: [P('+', 0, -32, 'up', 'positive'), P('-', 0, 32, 'down', 'negative')],
    defaults: () => ({ resistance: 2, ke: 1.0, maxCurrent: 10 }),
    description: 'DC winding and speed-dependent back-EMF motor model.',
    keywords: ['motor', 'dc', 'actuator', 'back emf', 'output'],
  },
  buzzer: {
    label: 'Buzzer',
    category: 'outputs',
    symbolSize: { w: 60, h: 60 },
    pins: [P('+', 0, -30, 'up', 'positive'), P('-', 0, 30, 'down', 'negative')],
    defaults: () => ({ resistance: 100, frequency: 440 }),
    description: 'Audible buzzer with resistive drive and frequency output.',
    keywords: ['buzzer', 'sound', 'audio', 'alarm', 'output'],
  },
  gate: {
    label: 'Logic Gate',
    category: 'logic',
    symbolSize: { w: 76, h: 72 },
    pins: [
      P('IN1', -38, -18, 'left', 'input'),
      P('IN2', -38, 18, 'left', 'input'),
      P('OUT', 38, 0, 'right', 'output'),
    ],
    defaults: () => ({ gateType: 'AND' }),
    description: 'Five-volt combinational logic gate with output resistance.',
    keywords: ['logic', 'gate', 'and', 'or', 'not', 'xor'],
  },
  transistor: {
    label: 'Transistor',
    category: 'semiconductors',
    symbolSize: { w: 64, h: 64 },
    pins: [
      P('B', -32, 0, 'left', 'base'),
      P('C', 32, -24, 'right', 'collector'),
      P('E', 32, 24, 'right', 'emitter'),
    ],
    defaults: () => ({ transistorKind: 'NPN', rce: 2 }),
    description: 'Idealized NPN or PNP bipolar junction transistor switch.',
    keywords: ['transistor', 'bjt', 'npn', 'pnp', 'semiconductor'],
  },
  fuse: {
    label: 'Fuse',
    category: 'power',
    symbolSize: { w: 60, h: 44 },
    pins: [P('A', -30, 0, 'left', 'passive'), P('B', 30, 0, 'right', 'passive')],
    defaults: () => ({ maxCurrent: 1 }),
    description: 'Resettable schematic fuse contact with a current rating.',
    keywords: ['fuse', 'protection', 'overcurrent', 'power'],
  },
  capacitor: {
    label: 'Capacitor',
    category: 'passive',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ capacitance: 0.001, initialVoltage: 0 }),
    description: 'Transient energy-storage capacitor with an initial terminal voltage.',
    keywords: ['capacitor', 'capacitance', 'farad', 'transient', 'passive'],
  },
  inductor: {
    label: 'Inductor',
    category: 'passive',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ inductance: 0.1, initialCurrent: 0 }),
    description: 'Transient energy-storage inductor with an initial branch current.',
    keywords: ['inductor', 'inductance', 'henry', 'coil', 'transient'],
  },
  schottky: {
    label: 'Schottky Diode',
    category: 'semiconductors',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('K', 0, 30, 'down', 'passive')],
    defaults: () => ({ forwardVoltage: 0.3 }),
    description: 'Low-forward-voltage Schottky rectifier.',
    keywords: ['schottky', 'diode', 'rectifier', 'low dropout'],
  },
  zenerDiode: {
    label: 'Zener Diode',
    category: 'semiconductors',
    symbolSize: { w: 44, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('K', 0, 30, 'down', 'passive')],
    defaults: () => ({ forwardVoltage: 0.7, zenerVoltage: 5.1 }),
    description: 'Diode with forward conduction and reverse Zener breakdown.',
    keywords: ['zener', 'diode', 'breakdown', 'regulator', 'voltage'],
  },
  rgbLed: {
    label: 'RGB LED',
    category: 'outputs',
    symbolSize: { w: 76, h: 64 },
    pins: [
      P('R', -38, -24, 'left', 'input'),
      P('G', -38, 0, 'left', 'input'),
      P('B', -38, 24, 'left', 'input'),
      P('K', 38, 0, 'right', 'negative'),
    ],
    defaults: () => ({ forwardVoltage: 2.2, color: 'rgb' }),
    description: 'Three independent LED channels with a shared cathode.',
    keywords: ['rgb', 'led', 'red', 'green', 'blue', 'light'],
  },
  incandescent: {
    label: 'Incandescent Lamp',
    category: 'outputs',
    symbolSize: { w: 60, h: 60 },
    pins: [P('+', 0, -30, 'up', 'positive'), P('-', 0, 30, 'down', 'negative')],
    defaults: () => ({ resistance: 24, ratedPower: 12, maxCurrent: 2 }),
    description: 'Resistive filament lamp with power-dependent brightness.',
    keywords: ['incandescent', 'lamp', 'bulb', 'filament', 'light'],
  },
  photoresistor: {
    label: 'Photoresistor',
    category: 'inputs',
    symbolSize: { w: 52, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ resistance: 1000, darkResistance: 1000000, lightLevel: 0.5 }),
    description: 'Light-controlled resistor interpolating between dark and bright resistance.',
    keywords: ['photoresistor', 'ldr', 'light', 'sensor', 'resistance'],
  },
  thermistor: {
    label: 'Thermistor',
    category: 'inputs',
    symbolSize: { w: 52, h: 60 },
    pins: [P('A', 0, -30, 'up', 'passive'), P('B', 0, 30, 'down', 'passive')],
    defaults: () => ({ resistance: 10000, beta: 3950, temperature: 25 }),
    description: 'NTC temperature sensor using the beta-parameter resistance equation.',
    keywords: ['thermistor', 'ntc', 'temperature', 'beta', 'sensor'],
  },
  relay: {
    label: 'Relay',
    category: 'outputs',
    symbolSize: { w: 96, h: 88 },
    pins: [
      P('A', -48, -24, 'left', 'input'),
      P('B', -48, 24, 'left', 'input'),
      P('COM', 48, 0, 'right', 'passive'),
      P('NO', 48, -32, 'right', 'output'),
      P('NC', 48, 32, 'right', 'output'),
    ],
    defaults: () => ({ resistance: 200, pickupVoltage: 5, maxCurrent: 5 }),
    description: 'Resistive relay coil driving common, normally-open and normally-closed contacts.',
    keywords: ['relay', 'coil', 'spdt', 'contact', 'no', 'nc'],
  },
  mosfet: {
    label: 'MOSFET',
    category: 'semiconductors',
    symbolSize: { w: 64, h: 64 },
    pins: [
      P('G', -32, 0, 'left', 'base'),
      P('D', 32, -24, 'right', 'collector'),
      P('S', 32, 24, 'right', 'emitter'),
    ],
    defaults: () => ({ mosfetKind: 'N', thresholdVoltage: 2, rdsOn: 0.05 }),
    description: 'N- or P-channel MOSFET switch with threshold voltage and on-resistance.',
    keywords: ['mosfet', 'fet', 'n channel', 'p channel', 'switch'],
  },
  currentSource: {
    label: 'Current Source',
    category: 'power',
    symbolSize: { w: 54, h: 60 },
    pins: [P('A', 0, -30, 'up', 'positive'), P('B', 0, 30, 'down', 'negative')],
    defaults: () => ({ current: 0.01 }),
    description: 'Independent source delivering its configured current out of A and returning through B.',
    keywords: ['current source', 'constant current', 'dc', 'power'],
  },
  clock: {
    label: 'Clock',
    category: 'logic',
    symbolSize: { w: 76, h: 52 },
    pins: [P('OUT', 38, 0, 'right', 'output'), P('GND', -38, 0, 'left', 'negative')],
    defaults: () => ({ frequency: 1, amplitude: 5, dutyCycle: 0.5, outputResistance: 50 }),
    description: 'Time-driven square-wave source with frequency, amplitude and duty-cycle controls.',
    keywords: ['clock', 'square wave', 'oscillator', 'frequency', 'logic'],
  },
  opAmp: {
    label: 'Operational Amplifier',
    category: 'semiconductors',
    symbolSize: { w: 88, h: 88 },
    pins: [
      P('IN+', -44, -22, 'left', 'input'),
      P('IN-', -44, 22, 'left', 'input'),
      P('OUT', 44, 0, 'right', 'output'),
      P('V+', 0, -44, 'up', 'positive'),
      P('V-', 0, 44, 'down', 'negative'),
    ],
    defaults: () => ({ gain: 100000, outputResistance: 5 }),
    description: 'High-gain differential amplifier with supply-rail-limited output.',
    keywords: ['op amp', 'operational amplifier', 'differential', 'gain', 'analog'],
  },
  solenoid: {
    label: 'Solenoid',
    category: 'outputs',
    symbolSize: { w: 64, h: 60 },
    pins: [P('+', 0, -30, 'up', 'positive'), P('-', 0, 30, 'down', 'negative')],
    defaults: () => ({ resistance: 12, pickupVoltage: 3, maxCurrent: 2, ratedPower: 12 }),
    description: 'Resistive electromagnetic actuator with a pickup-voltage threshold.',
    keywords: ['solenoid', 'coil', 'electromagnet', 'actuator', 'output'],
  },
  fan: {
    label: 'Fan',
    category: 'outputs',
    symbolSize: { w: 64, h: 64 },
    pins: [P('+', 0, -32, 'up', 'positive'), P('-', 0, 32, 'down', 'negative')],
    defaults: () => ({ resistance: 4, ke: 0.5, maxCurrent: 3 }),
    description: 'Fan driven by the DC motor winding and back-EMF model.',
    keywords: ['fan', 'motor', 'cooling', 'actuator', 'back emf'],
  },
  speaker: {
    label: 'Speaker',
    category: 'outputs',
    symbolSize: { w: 60, h: 60 },
    pins: [P('+', 0, -30, 'up', 'positive'), P('-', 0, 30, 'down', 'negative')],
    defaults: () => ({ resistance: 8, frequency: 440, ratedPower: 1 }),
    description: 'Speaker using the resistive buzzer drive and audio-state model.',
    keywords: ['speaker', 'audio', 'sound', 'buzzer', 'output'],
  },
}

/** Components whose pins use horizontal stubs (drawn rotated in symbol). */
export function pinWorldPos(comp: { x: number; y: number }, pin: PinDef): { x: number; y: number } {
  return { x: comp.x + pin.x, y: comp.y + pin.y }
}

export function findPin(type: CircuitComponentType, pinName: string): PinDef | undefined {
  return COMPONENT_DEFS[type]?.pins.find((p) => p.name === pinName)
}

export const GATE_LABELS: Record<string, string> = {
  AND: '&',
  NAND: '&',
  OR: '\u22651',
  NOR: '\u22651',
  XOR: '=1',
  XNOR: '=1',
  NOT: '1',
}

export function gateHasSecondInput(gateType: string): boolean {
  return gateType !== 'NOT'
}

/** Pretty formatting of a key code for UI. */
export function formatKeyCode(code: string): string {
  if (!code) return ''
  const map: Record<string, string> = {
    Space: 'Space',
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    ArrowLeft: '\u2190',
    ArrowRight: '\u2192',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Tab: 'Tab',
  }
  if (map[code]) return map[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6)
  return code
}
