import { COMPONENT_DEFS } from './components'
import type { CircuitComponentType, CircuitProps, GateType } from '../types'

export interface CatalogEntry {
  id: string
  type: CircuitComponentType
  label: string
  description: string
  keywords: string[]
  props?: Partial<CircuitProps>
}

const item = (
  type: CircuitComponentType,
  id: string = type,
  label?: string,
  description?: string,
  keywords: string[] = [],
  props?: Partial<CircuitProps>,
): CatalogEntry => ({
  id,
  type,
  label: label ?? COMPONENT_DEFS[type].label,
  description: description ?? COMPONENT_DEFS[type].description,
  keywords: [...COMPONENT_DEFS[type].keywords, ...keywords],
  props,
})

const gates: { gate: GateType; label: string; keywords: string[] }[] = [
  { gate: 'AND', label: 'AND Gate', keywords: ['conjunction', 'both inputs'] },
  { gate: 'OR', label: 'OR Gate', keywords: ['disjunction', 'either input'] },
  { gate: 'NOT', label: 'NOT Gate / Inverter', keywords: ['invert', 'inverting buffer'] },
  { gate: 'NAND', label: 'NAND Gate', keywords: ['inverted and', 'universal gate'] },
  { gate: 'NOR', label: 'NOR Gate', keywords: ['inverted or', 'universal gate'] },
  { gate: 'XOR', label: 'XOR Gate', keywords: ['exclusive or', 'different inputs'] },
  { gate: 'XNOR', label: 'XNOR Gate', keywords: ['exclusive nor', 'equality', 'same inputs'] },
]

export const CIRCUIT_CATALOG: CatalogEntry[] = [
  item('battery', 'battery', 'DC Power Supply', 'Adjustable DC source with current-limit protection.', ['voltage source', 'vcc', '9v', '12v']),
  item('ground', 'ground', 'Ground Reference', 'Zero-volt reference for the circuit.', ['gnd', '0v', 'earth', 'common']),
  item('fuse', 'fuse', 'Safety Fuse', 'Opens permanently when its current rating is exceeded.', ['protection', 'overcurrent', 'breaker']),
  item('currentSource'),
  item('resistor'),
  item('capacitor', 'capacitor', 'Electrolytic Capacitor', 'Stores charge and smooths changing voltage.', ['electrolytic', '1000uf', 'condenser']),
  item('capacitor', 'capacitorCeramic', 'Ceramic Capacitor', 'Small capacitor for timing and high-frequency decoupling.', ['ceramic', '100nf', 'decoupling', 'bypass'], { capacitance: 0.0000001 }),
  item('inductor', 'inductor', undefined, undefined, ['choke', 'reactor', 'magnetic']),
  item('potentiometer'),
  item('switchPush'),
  item('switchSlide'),
  item('switchPush', 'limitSwitch', 'Limit Switch', 'Momentary contact for travel limits and mechanical detection.', ['endstop', 'microswitch', 'momentary', 'travel']),
  item('switchSlide', 'reedSwitch', 'Reed Switch', 'Magnetically actuated contact with a latching control model.', ['magnetic', 'proximity', 'contact']),
  item('photoresistor'),
  item('thermistor'),
  item('led'),
  item('rgbLed'),
  item('incandescent'),
  item('motor'),
  item('fan'),
  item('buzzer'),
  item('speaker'),
  item('solenoid'),
  item('diode'),
  item('schottky'),
  item('zenerDiode'),
  item('transistor', 'transistorNpn', 'NPN Transistor', 'Current-controlled NPN switch.', ['bjt', 'low side', 'switch']),
  item('transistor', 'transistorPnp', 'PNP Transistor', 'Current-controlled PNP switch.', ['bjt', 'high side', 'switch'], { transistorKind: 'PNP' }),
  item('mosfet', 'mosfetN', 'N-channel MOSFET', 'Voltage-controlled N-channel power switch.', ['nmos', 'fet', 'low side']),
  item('mosfet', 'mosfetP', 'P-channel MOSFET', 'Voltage-controlled P-channel power switch.', ['pmos', 'fet', 'high side'], { mosfetKind: 'P' }),
  item('relay'),
  item('opAmp'),
  ...gates.map(({ gate, label, keywords }) => item('gate', `gate${gate}`, label, COMPONENT_DEFS.gate.description, keywords, { gateType: gate })),
  item('clock'),
]

export const CATEGORY_ORDER = ['power', 'passive', 'inputs', 'outputs', 'semiconductors', 'logic'] as const

export const CATEGORY_LABELS: Record<string, string> = {
  power: 'Power & protection',
  passive: 'Passive components',
  inputs: 'Switches & sensors',
  outputs: 'Lights, sound & motion',
  semiconductors: 'Semiconductors',
  logic: 'Logic & signals',
}

export function resolveCatalogEntry(id: string | null): CatalogEntry | null {
  if (!id) return null
  const explicit = CIRCUIT_CATALOG.find((entry) => entry.id === id)
  if (explicit) return explicit
  const type = id as CircuitComponentType
  return COMPONENT_DEFS[type] ? item(type) : null
}

export function propsForCatalogEntry(entry: CatalogEntry): CircuitProps {
  return { ...COMPONENT_DEFS[entry.type].defaults(), ...entry.props }
}

export function searchCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return entries
  return entries
    .map((entry) => {
      const label = entry.label.toLowerCase()
      const haystack = [entry.label, entry.type, entry.description, CATEGORY_LABELS[COMPONENT_DEFS[entry.type].category], ...entry.keywords]
        .join(' ')
        .toLowerCase()
      if (!tokens.every((token) => haystack.includes(token))) return { entry, score: -1 }
      let score = 1
      if (label === query.toLowerCase().trim()) score += 20
      if (label.startsWith(tokens[0])) score += 8
      if (tokens.every((token) => label.includes(token))) score += 4
      return { entry, score }
    })
    .filter((result) => result.score >= 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .map((result) => result.entry)
}
