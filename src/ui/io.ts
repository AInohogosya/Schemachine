// ============================================================================
// Save / load: .schemachine.json export + import with strict validation, plus
// localStorage autosave.
// ============================================================================

import type { ProjectData } from '../types'
import { CURRENT_VERSION } from '../types'
import { COMPONENT_DEFS } from '../circuit/components'

const AUTOSAVE_KEY = 'schemachine.autosave.v1'
const LEGACY_AUTOSAVE_KEY = 'fablegame.autosave.v1'

export function serializeProject(p: ProjectData): string {
  return JSON.stringify(p, null, 2)
}

export function downloadProject(p: ProjectData) {
  const blob = new Blob([serializeProject(p)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safe = (p.name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project'
  a.href = url
  a.download = `${safe}.schemachine.json`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 500)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

/** Validate + repair an imported file into a safe ProjectData. Throws on fatal errors. */
export function parseProjectFile(text: string): ProjectData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a valid JSON file.')
  }
  if (!isObj(raw)) throw new Error('Project file must be a JSON object.')
  const circuit = isObj(raw.circuit) ? raw.circuit : {}
  const hardware = isObj(raw.hardware) ? raw.hardware : {}

  const components = Array.isArray(circuit.components) ? circuit.components : []
  const wires = Array.isArray(circuit.wires) ? circuit.wires : []
  const parts = Array.isArray(hardware.parts) ? hardware.parts : []
  const joints = Array.isArray(hardware.joints) ? hardware.joints : []

  const validTypes = new Set<string>(Object.keys(COMPONENT_DEFS))
  const validKinds = new Set([
    'board', 'chassis', 'wheel', 'gear', 'propeller', 'wing', 'axle', 'duck',
    'block', 'deco', 'plant', 'thruster', 'ledBulb', 'switchPad', 'speaker',
    'batteryPack', 'emitter', 'water',
  ])

  const compIds = new Set<string>()
  const compTypeById = new Map<string, string>()
  const cleanComps = []
  for (const c of components) {
    if (!isObj(c)) continue
    if (!validTypes.has(str(c.type, ''))) continue
    const id = str(c.id, '')
    if (!id || compIds.has(id)) continue
    compIds.add(id)
    compTypeById.set(id, str(c.type, ''))
    cleanComps.push({
      id,
      name: str(c.name, 'Unnamed'),
      type: c.type,
      x: num(c.x, 0),
      y: num(c.y, 0),
      props: isObj(c.props) ? (c.props as ProjectData['circuit']['components'][number]['props']) : {},
    })
  }
  const cleanWires = []
  const wireIds = new Set<string>()
  for (const w of wires) {
    if (!isObj(w)) continue
    const id = str(w.id, '')
    if (!id || wireIds.has(id)) continue
    const from = isObj(w.from) ? w.from : null
    const to = isObj(w.to) ? w.to : null
    if (!from || !to) continue
    const fc = str(from.componentId, '')
    const tc = str(to.componentId, '')
    if (!compIds.has(fc) || !compIds.has(tc)) continue
    const fromPin = str(from.pin, '')
    const toPin = str(to.pin, '')
    const fromType = compTypeById.get(fc) as ProjectData['circuit']['components'][number]['type'] | undefined
    const toType = compTypeById.get(tc) as ProjectData['circuit']['components'][number]['type'] | undefined
    if (!fromType || !toType) continue
    if (!COMPONENT_DEFS[fromType].pins.some((pin) => pin.name === fromPin)) continue
    if (!COMPONENT_DEFS[toType].pins.some((pin) => pin.name === toPin)) continue
    wireIds.add(id)
    cleanWires.push({
      id,
      from: { componentId: fc, pin: fromPin },
      to: { componentId: tc, pin: toPin },
    })
  }

  const partIds = new Set<string>()
  const cleanParts = []
  for (const p of parts) {
    if (!isObj(p)) continue
    if (!validKinds.has(str(p.kind, ''))) continue
    const id = str(p.id, '')
    if (!id || partIds.has(id)) continue
    partIds.add(id)
    cleanParts.push({
      id,
      name: str(p.name, 'Part'),
      kind: p.kind,
      x: num(p.x, 0),
      y: num(p.y, 0),
      z: num((p as Record<string, unknown>).z, 0),
      angle: num(p.angle, 0),
      w: Math.max(4, num(p.w, 40)),
      h: Math.max(4, num(p.h, 40)),
      props: isObj(p.props) ? (p.props as ProjectData['hardware']['parts'][number]['props']) : {},
    })
  }
  const cleanJoints = []
  const jointIds = new Set<string>()
  for (const j of joints) {
    if (!isObj(j)) continue
    const id = str(j.id, '')
    if (!id || jointIds.has(id)) continue
    const a = str(j.a, '')
    const b = str(j.b, '')
    if (!partIds.has(a) || !partIds.has(b) || a === b) continue
    if (!['weld', 'pin', 'motor', 'slider'].includes(str(j.type, ''))) continue
    jointIds.add(id)
    cleanJoints.push({
      id,
      type: j.type,
      a,
      b,
      ax: num(j.ax, 0),
      ay: num(j.ay, 0),
      bx: num(j.bx, 0),
      by: num(j.by, 0),
      props: isObj(j.props) ? (j.props as ProjectData['hardware']['joints'][number]['props']) : {},
    })
  }

  if (cleanComps.length === 0 && cleanParts.length === 0 && (!Array.isArray(circuit.components) || !Array.isArray(hardware.parts))) {
    throw new Error('File contains no valid components or parts.')
  }

  return {
    version: CURRENT_VERSION,
    name: str(raw.name, 'Imported Project'),
    groundY: num(raw.groundY, 900),
    circuit: { components: cleanComps as ProjectData['circuit']['components'], wires: cleanWires },
    hardware: {
      parts: cleanParts as ProjectData['hardware']['parts'],
      joints: cleanJoints as ProjectData['hardware']['joints'],
      meshes: sanitizeMeshes(isObj(hardware) ? (hardware as Record<string, unknown>).meshes : undefined),
    },
  }
}

const MESH_BASES = new Set(['plate', 'cylinder', 'sphere'])

/** Validate the Part Studio mesh library (drops corrupt entries). */
export function sanitizeMeshes(raw: unknown): ProjectData['hardware']['meshes'] {
  if (!Array.isArray(raw)) return []
  const out: ProjectData['hardware']['meshes'] = []
  const ids = new Set<string>()
  for (const m of raw) {
    if (typeof m !== 'object' || m === null) continue
    const rec = m as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id : ''
    if (!id || ids.has(id)) continue
    if (!MESH_BASES.has(typeof rec.base === 'string' ? (rec.base as string) : '')) continue
    const ops = Array.isArray(rec.ops) ? rec.ops : []
    const cleanOps = []
    for (const o of ops) {
      if (typeof o !== 'object' || o === null) continue
      const r = o as Record<string, unknown>
      cleanOps.push({
        x: num(r.x, 0),
        y: num(r.y, 0),
        z: num(r.z, 0),
        radius: Math.max(1, num(r.radius, 20)),
        strength: Math.max(-200, Math.min(200, num(r.strength, 0))),
        falloff: Math.max(0.5, Math.min(6, num(r.falloff, 2))),
      })
      if (cleanOps.length > 500) break
    }
    let stl: ProjectData['hardware']['meshes'][number]['stl']
    if (isObj(rec.stl)) {
      const s = rec.stl as Record<string, unknown>
      if (typeof s.positions === 'string' && typeof s.indices === 'string') {
        stl = {
          positions: s.positions.slice(0, 60_000_000),
          indices: s.indices.slice(0, 80_000_000),
          vertexCount: Math.max(0, Math.floor(num(s.vertexCount, 0))),
          triangleCount: Math.max(0, Math.floor(num(s.triangleCount, 0))),
        }
      }
    }
    ids.add(id)
    out.push({
      id,
      name: str(rec.name, 'Mesh'),
      base: rec.base as ProjectData['hardware']['meshes'][number]['base'],
      w: Math.max(4, num(rec.w, 80)),
      h: Math.max(4, num(rec.h, 80)),
      depth: Math.max(4, num(rec.depth, 24)),
      segments: Math.max(1, Math.min(48, Math.floor(num(rec.segments, 16)))),
      ops: cleanOps,
      stl,
    })
  }
  return out
}

export interface AutosaveStatus {
  state: 'idle' | 'saved' | 'restored' | 'error'
  time: number | null
  message: string
}

let autosaveStatus: AutosaveStatus = { state: 'idle', time: null, message: '' }
const autosaveListeners = new Set<() => void>()

function setAutosaveStatus(status: AutosaveStatus) {
  autosaveStatus = status
  for (const listener of autosaveListeners) listener()
}

export function getAutosaveStatus(): AutosaveStatus {
  return autosaveStatus
}

export function subscribeAutosave(listener: () => void): () => void {
  autosaveListeners.add(listener)
  return () => autosaveListeners.delete(listener)
}

export function autosave(p: ProjectData): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(p))
    setAutosaveStatus({ state: 'saved', time: Date.now(), message: 'Workspace autosaved in this browser.' })
    return true
  } catch (error) {
    setAutosaveStatus({
      state: 'error',
      time: null,
      message: error instanceof Error ? `Autosave failed: ${error.message}` : 'Autosave failed: storage unavailable.',
    })
    return false
  }
}

export function loadAutosave(): ProjectData | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (!text) return null
    const project = parseProjectFile(text)
    setAutosaveStatus({ state: 'restored', time: Date.now(), message: 'Autosave restored from this browser.' })
    return project
  } catch (error) {
    setAutosaveStatus({
      state: 'error',
      time: null,
      message: error instanceof Error ? `Could not restore autosave: ${error.message}` : 'Could not restore autosave.',
    })
    return null
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
    setAutosaveStatus({ state: 'idle', time: null, message: '' })
  } catch (error) {
    setAutosaveStatus({
      state: 'error',
      time: null,
      message: error instanceof Error ? `Autosave failed: ${error.message}` : 'Autosave failed: storage unavailable.',
    })
  }
}
