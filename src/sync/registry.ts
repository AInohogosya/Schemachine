// ============================================================================
// Binding registry — the bidirectional Signal Bus. Circuit components and
// hardware parts link strictly by Name ID (case-insensitive), from either
// side: a hardware part's `boundComponent` points at a circuit name, and a
// circuit component's `bindHardware` points at a hardware part name. Links
// created in the Hardware view first register into the same global pool so
// the schematic can bind to them immediately.
// ============================================================================

import type { CircuitComponentData, HardwarePartData, ProjectData } from '../types'

export interface Binding {
  circuit: CircuitComponentData
  hardware: HardwarePartData
}

function norm(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

/** All links between circuit components and hardware parts by Name ID. */
export function resolveBindings(project: ProjectData): Binding[] {
  const out: Binding[] = []
  const comps = project.circuit.components
  const parts = project.hardware.parts
  for (const c of comps) {
    const cn = norm(c.name)
    if (!cn) continue
    for (const h of parts) {
      const hn = norm(h.name)
      if (!hn) continue
      if (norm(h.props.boundComponent) === cn || norm(c.props.bindHardware) === hn) {
        out.push({ circuit: c, hardware: h })
      }
    }
  }
  return out
}

/** Find hardware parts bound to a circuit component id. */
export function hardwareBoundTo(project: ProjectData, circuitId: string): HardwarePartData[] {
  const c = project.circuit.components.find((x) => x.id === circuitId)
  if (!c) return []
  return resolveBindings(project)
    .filter((b) => b.circuit.id === circuitId)
    .map((b) => b.hardware)
}

/** Find circuit components bound to a hardware part id. */
export function circuitsBoundTo(project: ProjectData, hardwareId: string): CircuitComponentData[] {
  return resolveBindings(project)
    .filter((b) => b.hardware.id === hardwareId)
    .map((b) => b.circuit)
}

/** Name pools for the inspector dropdowns (both directions). */
export function bindingPools(project: ProjectData): { circuitNames: string[]; hardwareNames: string[] } {
  const circuitNames = project.circuit.components
    .map((c) => c.name)
    .filter((n) => n.trim().length > 0)
  const hardwareNames = project.hardware.parts
    .filter((p) => p.kind !== 'water')
    .map((p) => p.name)
    .filter((n) => n.trim().length > 0)
  return {
    circuitNames: [...new Set(circuitNames)].sort(),
    hardwareNames: [...new Set(hardwareNames)].sort(),
  }
}

function consumerCompatible(project: ProjectData, binding: Binding): boolean {
  const { circuit: c, hardware: h } = binding
  if (h.kind === 'switchPad') return c.type === 'switchPush' || c.type === 'switchSlide'
  if (h.kind === 'speaker') return c.type === 'buzzer' || c.type === 'speaker'
  if (h.kind === 'ledBulb') return c.type === 'led' || c.type === 'rgbLed' || c.type === 'incandescent'
  if (h.kind === 'batteryPack') return c.type === 'battery' || c.type === 'currentSource'
  if (h.kind === 'thruster') {
    return c.type === 'battery' || c.type === 'switchPush' || c.type === 'switchSlide' || c.type === 'motor' ||
      c.type === 'fan' || c.type === 'gate' || c.type === 'clock' || c.type === 'relay' || c.type === 'solenoid'
  }
  const rotor = project.hardware.joints.some((j) =>
    (j.type === 'motor' || j.type === 'pin') && (j.a === h.id || j.b === h.id))
  if (rotor) return c.type === 'motor' || c.type === 'fan'
  return true
}

/** Human-readable binding diagnostics for warnings / inspector hints. */
export function bindingDiagnostics(project: ProjectData): string[] {
  const issues: string[] = []
  const circuitNames = new Set(project.circuit.components.map((c) => norm(c.name)))
  const hardwareNames = new Set(project.hardware.parts.map((p) => norm(p.name)))
  const addDuplicates = (entries: { name: string }[], label: string) => {
    const groups = new Map<string, number>()
    for (const entry of entries) {
      const name = norm(entry.name)
      if (name) groups.set(name, (groups.get(name) ?? 0) + 1)
    }
    for (const [name, count] of groups) {
      if (count > 1) issues.push(`Duplicate ${label} Name ID "${name}" is shared by ${count} entries`)
    }
  }
  addDuplicates(project.circuit.components, 'circuit')
  addDuplicates(project.hardware.parts, 'hardware')
  for (const p of project.hardware.parts) {
    const b = norm(p.props.boundComponent)
    if (b && !circuitNames.has(b)) {
      issues.push(`"${p.name}" is bound to missing circuit component "${p.props.boundComponent}"`)
    }
  }
  for (const c of project.circuit.components) {
    const b = norm(c.props.bindHardware)
    if (b && !hardwareNames.has(b)) {
      issues.push(`"${c.name}" is bound to missing hardware part "${c.props.bindHardware}"`)
    }
  }
  for (const binding of resolveBindings(project)) {
    if (!consumerCompatible(project, binding)) {
      issues.push(`Circuit component "${binding.circuit.name}" (${binding.circuit.type}) is incompatible with hardware consumer "${binding.hardware.name}" (${binding.hardware.kind})`)
    }
  }
  for (const joint of project.hardware.joints) {
    if (joint.type !== 'motor' && joint.type !== 'pin') continue
    const bound = norm(joint.props.boundComponent)
    if (!bound) continue
    const matches = project.circuit.components.filter((c) => norm(c.name) === bound)
    if (matches.length === 0) {
      issues.push(`Joint "${joint.id}" is bound to missing circuit component "${joint.props.boundComponent}"`)
    }
    for (const c of matches) {
      if (c.type !== 'motor' && c.type !== 'fan') {
        issues.push(`Circuit component "${c.name}" (${c.type}) is incompatible with motor joint "${joint.id}"`)
      }
    }
  }
  return issues
}
