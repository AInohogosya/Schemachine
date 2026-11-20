// ============================================================================
// Runtime singleton — the shared live circuit engine. Structural edits bump
// store.circuitRev; the tick loop recompiles automatically.
// ============================================================================

import { CircuitEngine } from './circuit/engine'
import { store } from './store'

export let circuit: CircuitEngine | null = null
let seenRev = -1
let seenProject: unknown = null
let runtimeRevision = 0
let runtimeError: string | null = null
let lastNotify = 0
let lastSignature = ''
let lastErrorLog = 0
const listeners = new Set<() => void>()

export function ensureRuntime(): CircuitEngine {
  if (!circuit || seenProject !== store.project) {
    circuit = new CircuitEngine(store.project.circuit)
    seenProject = store.project
    seenRev = store.circuitRev
    circuit.tick(performance.now())
    return circuit
  }
  if (store.circuitRev !== seenRev) {
    seenRev = store.circuitRev
    circuit.rebuild(store.project.circuit)
  }
  return circuit
}

export function getCircuit(): CircuitEngine {
  return ensureRuntime()
}

export const subscribeRuntime = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRuntimeRevision(): number {
  return runtimeRevision
}

export function getRuntimeError(): string | null {
  return runtimeError
}

function publishRuntime(force = false) {
  const now = performance.now()
  const signature = `${runtimeError ?? ''}|${circuit?.runtime.solved ?? false}|${circuit?.runtime.warnings.join('|') ?? ''}`
  if (!force && signature === lastSignature && now - lastNotify < 250) return
  lastNotify = now
  lastSignature = signature
  runtimeRevision++
  for (const listener of listeners) listener()
}

export function reportRuntimeFailure(error: unknown) {
  runtimeError = error instanceof Error ? error.message : 'Circuit update failed.'
  const now = performance.now()
  if (now - lastErrorLog > 5000) {
    lastErrorLog = now
    console.error('SCHEMACHINE circuit update failed:', error)
  }
  publishRuntime(true)
}

export function tickRuntime(now = performance.now()) {
  try {
    getCircuit().tick(now)
    runtimeError = null
  } catch (error) {
    reportRuntimeFailure(error)
    return
  }
  publishRuntime()
}

export function notifyRuntime() {
  publishRuntime(true)
}
