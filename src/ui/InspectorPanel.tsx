// ============================================================================
// Right panel: property inspector for the current selection + project
// settings and binding diagnostics when nothing is selected.
// ============================================================================

import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { COMPONENT_DEFS, formatKeyCode } from '../circuit/components'
import { getCircuit, getRuntimeError, getRuntimeRevision, subscribeRuntime } from '../runtime'
import { bindingDiagnostics, bindingPools } from '../sync/registry'
import { existingNames, store } from '../store'
import type { CircuitComponentData, CircuitComponentType, HardwarePartData, HardwarePartType, JointData } from '../types'
import { partLocalToWorld, worldToPartLocal } from './HardwareView'

function NumField(props: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        step={props.step ?? 1}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  )
}

function TextField(props: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input id={id} type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} spellCheck={false} />
    </div>
  )
}

function RangeField(props: { label: string; value: number; min: number; max: number; step: number; format?: (value: number) => string; onChange: (value: number) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}{props.format ? ` (${props.format(props.value)})` : ''}</label>
      <input id={id} type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))}/>
    </div>
  )
}

function SelectField(props: { label: string; value: string; options: (string | { v: string; label: string })[]; onChange: (v: string) => void; allowEmpty?: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.allowEmpty !== undefined && <option value="">{props.allowEmpty}</option>}
        {props.options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ),
        )}
      </select>
    </div>
  )
}

function KeyRecorder(props: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  const [rec, setRec] = useState(false)
  useEffect(() => {
    if (!rec) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      props.onChange(e.code)
      setRec(false)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec])
  return (
    <div className="field">
      <label htmlFor={id}>Keyboard key</label>
      <div className="row2">
        <input id={id} type="text" readOnly value={props.value ? formatKeyCode(props.value) : '(none)'} />
        <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => (props.value ? props.onChange('') : setRec(true))}>
          {props.value ? 'Clear' : rec ? 'Press…' : 'Set'}
        </button>
      </div>
      {rec && <div className="help-text">Press any key…</div>}
    </div>
  )
}

function uniqueRename(currentId: string, currentName: string, next: string): string {
  const trimmed = next.trim() || 'Unnamed'
  const names = new Set<string>()
  for (const c of store.project.circuit.components) if (c.id !== currentId) names.add(c.name.trim().toLowerCase())
  for (const p of store.project.hardware.parts) if (p.id !== currentId) names.add(p.name.trim().toLowerCase())
  if (!names.has(trimmed.toLowerCase()) || trimmed.toLowerCase() === currentName.trim().toLowerCase()) return trimmed
  let i = 2
  while (names.has(`${trimmed} ${i}`.toLowerCase())) i++
  return `${trimmed} ${i}`
}

const THRUSTER_DRIVERS: CircuitComponentType[] = ['battery', 'switchPush', 'switchSlide', 'motor', 'fan', 'gate', 'clock', 'relay', 'solenoid', 'transistor', 'mosfet']
const FLOW_DRIVERS: CircuitComponentType[] = ['switchPush', 'switchSlide', 'gate', 'clock', 'relay', 'solenoid', 'motor', 'fan', 'transistor', 'mosfet']

function compatibleHardwareFor(c: CircuitComponentData, p: HardwarePartData): boolean {
  switch (p.kind) {
    case 'switchPad': return c.type === 'switchPush' || c.type === 'switchSlide'
    case 'speaker': return c.type === 'buzzer' || c.type === 'speaker'
    case 'ledBulb': return c.type === 'led' || c.type === 'rgbLed' || c.type === 'incandescent'
    case 'batteryPack': return c.type === 'battery' || c.type === 'currentSource'
    case 'thruster': return THRUSTER_DRIVERS.includes(c.type)
    case 'emitter': return FLOW_DRIVERS.includes(c.type)
    case 'propeller': return c.type === 'motor' || c.type === 'fan'
    default: return false
  }
}

function compatibleCircuitsForPart(p: HardwarePartData): CircuitComponentData[] {
  return store.project.circuit.components.filter((c) => compatibleHardwareFor(c, p))
}

function compatibleCircuitsForJoint(j: JointData): CircuitComponentData[] {
  return store.project.circuit.components.filter((c) => c.type === 'motor' || c.type === 'fan')
}

export default function InspectorPanel() {
  useSyncExternalStore(
    store.subscribe,
    () => store.selection.id + store.selection.kind + store.circuitRev + store.hardwareRev + store.view,
  )
  useSyncExternalStore(subscribeRuntime, getRuntimeRevision)
  const sel = store.selection
  if (sel.kind === 'circuit') {
    const c = store.circuitById(sel.id)
    if (c) return <CircuitInspector c={c} />
  } else if (sel.kind === 'wire') {
    const w = store.project.circuit.wires.find((x) => x.id === sel.id)
    if (w) return <WireInspector wireId={w.id} />
  } else if (sel.kind === 'part') {
    const p = store.partById(sel.id)
    if (p) return <PartInspector p={p} />
  } else if (sel.kind === 'joint') {
    const j = store.jointById(sel.id)
    if (j) return <JointInspector j={j} />
  }
  return <ProjectInspector />
}

// ---------------------------------------------------------------- circuit
function CircuitInspector({ c }: { c: CircuitComponentData }) {
  const p = c.props
  const pools = bindingPools(store.project)
  const switchId = useId()
  const def = COMPONENT_DEFS[c.type]
  const dirty = () => {
    store.markCircuitDirty()
    getCircuit().tick(performance.now())
  }
  const set = (patch: Partial<CircuitComponentData['props']>) => {
    store.beginChange(`comp:${c.id}:props`)
    Object.assign(p, patch)
    dirty()
  }
  return (
    <aside className="side right insp" aria-label={`${def?.label ?? c.type} properties`}>
      <h3>{def?.label ?? c.type}</h3>
      <p className="inspector-type">{def?.description}</p>
      <TextField
        label="Name ID (binding key)"
        value={c.name}
        onChange={(v) => {
          store.beginChange(`comp:${c.id}:name`)
          c.name = uniqueRename(c.id, c.name, v)
          dirty()
        }}
      />
      <div className="row2">
        <NumField label="X" value={c.x} step={20} onChange={(v) => { store.beginChange(`comp:${c.id}:xy`); c.x = v; dirty() }} />
        <NumField label="Y" value={c.y} step={20} onChange={(v) => { store.beginChange(`comp:${c.id}:xy`); c.y = v; dirty() }} />
      </div>
      <div className="inspector-section">Electrical properties</div>
      {(c.type === 'switchPush' || c.type === 'switchSlide') && (
        <>
          <KeyRecorder value={p.key ?? ''} onChange={(v) => set({ key: v || undefined })} />
          <div className="field checkrow">
            <input id={switchId} type="checkbox" checked={p.closed === true} onChange={(e) => set({ closed: e.target.checked })} />
            <label htmlFor={switchId}>Closed (ON)</label>
          </div>
          <p className="help-text">
            {c.type === 'switchPush'
              ? 'Momentary contact: hold the bound key or pointer to keep it closed.'
              : 'Latching contact: click the symbol or press the bound key to toggle.'}
          </p>
        </>
      )}
      {c.type === 'battery' && (
        <>
          <NumField label="Voltage (V)" value={p.voltage ?? 9} step={1} min={0} max={48} onChange={(v) => set({ voltage: v })} />
          <NumField label="Trip current (A)" value={p.maxCurrent ?? 8} step={0.5} min={0.1} onChange={(v) => set({ maxCurrent: Math.max(0.1, v) })} />
          {(p.tripped || getCircuit().runtime.states.get(c.id)?.tripped) && <div className="err">Short-circuit protection tripped. It retries automatically after the short is removed.</div>}
        </>
      )}
      {c.type === 'resistor' && <NumField label="Resistance (Ω)" value={p.resistance ?? 220} step={10} min={0.01} onChange={(v) => set({ resistance: Math.max(0.01, v) })} />}
      {c.type === 'capacitor' && (
        <>
          <NumField label="Capacitance (µF)" value={(p.capacitance ?? 0.001) * 1000000} step={10} min={0.001} onChange={(v) => set({ capacitance: Math.max(0.001, v) / 1000000 })} />
          <NumField label="Initial voltage (V)" value={p.initialVoltage ?? 0} step={0.1} onChange={(v) => set({ initialVoltage: v })} />
        </>
      )}
      {c.type === 'inductor' && (
        <>
          <NumField label="Inductance (mH)" value={(p.inductance ?? 0.1) * 1000} step={1} min={0.001} onChange={(v) => set({ inductance: Math.max(0.001, v) / 1000 })} />
          <NumField label="Initial current (mA)" value={(p.initialCurrent ?? 0) * 1000} step={1} onChange={(v) => set({ initialCurrent: v / 1000 })} />
        </>
      )}
      {(c.type === 'diode' || c.type === 'schottky' || c.type === 'zenerDiode') && (
        <NumField label="Forward voltage (V)" value={p.forwardVoltage ?? (c.type === 'schottky' ? 0.3 : 0.7)} step={0.1} min={0.1} onChange={(v) => set({ forwardVoltage: Math.max(0.1, v) })} />
      )}
      {c.type === 'zenerDiode' && <NumField label="Reverse breakdown (V)" value={p.zenerVoltage ?? 5.1} step={0.1} min={0.1} onChange={(v) => set({ zenerVoltage: Math.max(0.1, v) })} />}
      {(c.type === 'led' || c.type === 'rgbLed') && (
        <>
          {c.type === 'led' && <SelectField label="Color" value={p.color ?? 'red'} options={['red', 'green', 'blue', 'yellow', 'white']} onChange={(v) => set({ color: v as never })} />}
          <NumField label="Forward voltage (V)" value={p.forwardVoltage ?? 2} step={0.1} min={0.5} onChange={(v) => set({ forwardVoltage: Math.max(0.5, v) })} />
          {c.type === 'rgbLed' && <p className="help-text">R, G, and B are independent anodes. K is the shared cathode.</p>}
        </>
      )}
      {c.type === 'incandescent' && (
        <>
          <NumField label="Filament resistance (Ω)" value={p.resistance ?? 24} step={1} min={0.1} onChange={(v) => set({ resistance: Math.max(0.1, v) })} />
          <NumField label="Rated power (W)" value={p.ratedPower ?? 12} step={1} min={0.1} onChange={(v) => set({ ratedPower: Math.max(0.1, v) })} />
          <NumField label="Maximum current (A)" value={p.maxCurrent ?? 2} step={0.1} min={0.1} onChange={(v) => set({ maxCurrent: Math.max(0.1, v) })} />
        </>
      )}
      {c.type === 'potentiometer' && (
        <>
          <NumField label="Total resistance (Ω)" value={p.resistance ?? 10000} step={100} min={10} onChange={(v) => set({ resistance: Math.max(10, v) })} />
          <RangeField label="Wiper position" value={p.position ?? 0.5} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ position: v })} />
        </>
      )}
      {c.type === 'photoresistor' && (
        <>
          <NumField label="Bright resistance (Ω)" value={p.resistance ?? 1000} step={100} min={1} onChange={(v) => set({ resistance: Math.max(1, v) })} />
          <NumField label="Dark resistance (Ω)" value={p.darkResistance ?? 1000000} step={10000} min={1} onChange={(v) => set({ darkResistance: Math.max(1, v) })} />
          <RangeField label="Light level" value={p.lightLevel ?? 0.5} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ lightLevel: v })} />
        </>
      )}
      {c.type === 'thermistor' && (
        <>
          <NumField label="Resistance at 25°C (Ω)" value={p.resistance ?? 10000} step={1000} min={1} onChange={(v) => set({ resistance: Math.max(1, v) })} />
          <NumField label="Beta coefficient (K)" value={p.beta ?? 3950} step={50} min={1} onChange={(v) => set({ beta: Math.max(1, v) })} />
          <RangeField label="Temperature" value={p.temperature ?? 25} min={-40} max={150} step={1} format={(v) => `${v}°C`} onChange={(v) => set({ temperature: v })} />
        </>
      )}
      {(c.type === 'motor' || c.type === 'fan') && (
        <>
          <NumField label="Winding resistance (Ω)" value={p.resistance ?? (c.type === 'fan' ? 4 : 2)} step={0.5} min={0.1} onChange={(v) => set({ resistance: Math.max(0.1, v) })} />
          <NumField label="Back-EMF ke (V per rad/s)" value={p.ke ?? (c.type === 'fan' ? 0.5 : 1)} step={0.1} min={0.05} onChange={(v) => set({ ke: Math.max(0.05, v) })} />
          <NumField label="Rated current (A)" value={p.maxCurrent ?? (c.type === 'fan' ? 3 : 10)} step={0.5} min={0.5} onChange={(v) => set({ maxCurrent: Math.max(0.5, v) })} />
          <p className="help-text">Bind hardware motor joints to “{c.name}”. No-load speed is V / ke; external rotation generates back-EMF.</p>
        </>
      )}
      {(c.type === 'buzzer' || c.type === 'speaker') && (
        <>
          <NumField label="Frequency (Hz)" value={p.frequency ?? 440} step={10} min={40} max={4000} onChange={(v) => set({ frequency: Math.max(40, v) })} />
          <NumField label="Resistance (Ω)" value={p.resistance ?? (c.type === 'speaker' ? 8 : 100)} step={1} min={1} onChange={(v) => set({ resistance: Math.max(1, v) })} />
          {c.type === 'speaker' && <NumField label="Rated power (W)" value={p.ratedPower ?? 1} step={0.1} min={0.1} onChange={(v) => set({ ratedPower: Math.max(0.1, v) })} />}
        </>
      )}
      {c.type === 'relay' && (
        <>
          <NumField label="Coil resistance (Ω)" value={p.resistance ?? 200} step={10} min={1} onChange={(v) => set({ resistance: Math.max(1, v) })} />
          <NumField label="Pickup voltage (V)" value={p.pickupVoltage ?? 5} step={0.5} min={0.1} onChange={(v) => set({ pickupVoltage: Math.max(0.1, v) })} />
          <NumField label="Contact current (A)" value={p.maxCurrent ?? 5} step={0.5} min={0.1} onChange={(v) => set({ maxCurrent: Math.max(0.1, v) })} />
          <p className="help-text">Below pickup, COM connects to NC. At pickup, COM switches to NO.</p>
        </>
      )}
      {c.type === 'solenoid' && (
        <>
          <NumField label="Coil resistance (Ω)" value={p.resistance ?? 12} step={1} min={0.1} onChange={(v) => set({ resistance: Math.max(0.1, v) })} />
          <NumField label="Pickup voltage (V)" value={p.pickupVoltage ?? 3} step={0.5} min={0.1} onChange={(v) => set({ pickupVoltage: Math.max(0.1, v) })} />
          <NumField label="Rated power (W)" value={p.ratedPower ?? 12} step={1} min={0.1} onChange={(v) => set({ ratedPower: Math.max(0.1, v) })} />
        </>
      )}
      {c.type === 'gate' && <SelectField label="Gate type" value={p.gateType ?? 'AND'} options={['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']} onChange={(v) => set({ gateType: v as never })} />}
      {c.type === 'transistor' && (
        <>
          <SelectField label="Kind" value={p.transistorKind ?? 'NPN'} options={['NPN', 'PNP']} onChange={(v) => set({ transistorKind: v as never })} />
          <NumField label="Saturation Rce (Ω)" value={p.rce ?? 2} step={0.5} min={0.1} onChange={(v) => set({ rce: Math.max(0.1, v) })} />
          <p className="help-text">{(p.transistorKind ?? 'NPN') === 'NPN' ? 'Conducts collector to emitter when the base is about 0.6 V above the emitter.' : 'Conducts emitter to collector when the emitter is about 0.6 V above the base.'}</p>
        </>
      )}
      {c.type === 'mosfet' && (
        <>
          <SelectField label="Channel" value={p.mosfetKind ?? 'N'} options={[{ v: 'N', label: 'N-channel' }, { v: 'P', label: 'P-channel' }]} onChange={(v) => set({ mosfetKind: v as never })} />
          <NumField label="Threshold voltage (V)" value={p.thresholdVoltage ?? 2} step={0.1} min={0.1} onChange={(v) => set({ thresholdVoltage: Math.max(0.1, v) })} />
          <NumField label="On-resistance (Ω)" value={p.rdsOn ?? 0.05} step={0.01} min={0.001} onChange={(v) => set({ rdsOn: Math.max(0.001, v) })} />
        </>
      )}
      {c.type === 'currentSource' && <NumField label="Current (mA)" value={(p.current ?? 0.01) * 1000} step={1} onChange={(v) => set({ current: v / 1000 })} />}
      {c.type === 'clock' && (
        <>
          <NumField label="Frequency (Hz)" value={p.frequency ?? 1} step={0.1} min={0.001} onChange={(v) => set({ frequency: Math.max(0.001, v) })} />
          <NumField label="Amplitude (V)" value={p.amplitude ?? 5} step={0.5} min={0} onChange={(v) => set({ amplitude: Math.max(0, v) })} />
          <RangeField label="Duty cycle" value={p.dutyCycle ?? 0.5} min={0.01} max={0.99} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ dutyCycle: v })} />
          <NumField label="Output resistance (Ω)" value={p.outputResistance ?? 50} step={5} min={0.1} onChange={(v) => set({ outputResistance: Math.max(0.1, v) })} />
        </>
      )}
      {c.type === 'opAmp' && (
        <>
          <NumField label="Open-loop gain" value={p.gain ?? 100000} step={10000} min={1} onChange={(v) => set({ gain: Math.max(1, v) })} />
          <NumField label="Output resistance (Ω)" value={p.outputResistance ?? 5} step={1} min={0.1} onChange={(v) => set({ outputResistance: Math.max(0.1, v) })} />
          <p className="help-text">The output follows gain × (IN+ − IN−), limited by the V+ and V− supply rails.</p>
        </>
      )}
      {c.type === 'fuse' && (
        <>
          <NumField label="Rating (A)" value={p.maxCurrent ?? 1} step={0.1} min={0.05} onChange={(v) => set({ maxCurrent: Math.max(0.05, v) })} />
          {p.blown === true && (
            <>
              <div className="err">Fuse blown by overcurrent. Replace it to restore the circuit.</div>
              <button className="btn" onClick={() => { store.beginChange(`comp:${c.id}:fuse`); getCircuit().resetFuse(c); store.markCircuitDirty() }}>Replace fuse</button>
            </>
          )}
        </>
      )}
      <div className="inspector-section">Connections</div>
      <SelectField
        label="Bind to hardware part"
        value={p.bindHardware ?? ''}
        options={store.project.hardware.parts.filter((part) => part.kind !== 'water' && compatibleHardwareFor(c, part)).map((part) => part.name).filter((n) => n.trim().length > 0)}
        allowEmpty="(none)"
        onChange={(v) => set({ bindHardware: v || undefined })}
      />
      {p.bindHardware && !pools.hardwareNames.includes(p.bindHardware) && (
        <div className="warn">Bound hardware part “{p.bindHardware}” no longer exists.</div>
      )}
      <div className="row2 inspector-actions">
        <button className="btn" onClick={() => duplicateCircuit(c)}>Duplicate</button>
        <button className="btn danger" onClick={() => store.deleteSelection()}>Delete</button>
      </div>
    </aside>
  )
}

function duplicateCircuit(c: CircuitComponentData) {
  const names = existingNames(store.project.circuit.components, store.project.hardware.parts)
  store.beginChange(`duplicate:${c.id}`)
  const copy: CircuitComponentData = {
    id: `${c.id}_copy_${Math.floor(Math.random() * 1e6)}`,
    name: uniqueRename('', '', c.name),
    type: c.type,
    x: c.x + 60,
    y: c.y + 60,
    props: { ...c.props, key: undefined },
  }
  void names
  store.project.circuit.components.push(copy)
  store.setSelection({ kind: 'circuit', id: copy.id })
  store.markCircuitDirty()
}

// ---------------------------------------------------------------- wire
function WireInspector({ wireId }: { wireId: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])
  const w = store.project.circuit.wires.find((x) => x.id === wireId)
  if (!w) return null
  const from = store.circuitById(w.from.componentId)
  const to = store.circuitById(w.to.componentId)
  const rt = getCircuit().runtime.wires.get(wireId)
  return (
    <div className="side right insp">
      <h3>Wire</h3>
      <div className="field">
        <div className="field-label">From</div>
        <div>{from ? `${from.name} : ${w.from.pin}` : '(deleted component)'}</div>
      </div>
      <div className="field">
        <div className="field-label">To</div>
        <div>{to ? `${to.name} : ${w.to.pin}` : '(deleted component)'}</div>
      </div>
      {rt && (
        <>
          <div className="field">
            <div className="field-label">Current</div>
            <div className={'field-value' + (rt.overloaded ? ' hot' : '')}>{(rt.current * 1000).toFixed(1)} mA{rt.overloaded ? ' — OVERLOAD' : ''}</div>
            <div className="livebar"><div className={'livebar-fill' + (rt.overloaded ? ' hot' : '')} style={{ width: `${Math.min(100, (Math.abs(rt.current) / 8) * 100)}%` }} /></div>
          </div>
          <div className="field">
            <div className="field-label">Endpoint voltages</div>
            <div>{rt.vA.toFixed(2)} V → {rt.vB.toFixed(2)} V</div>
          </div>
        </>
      )}
      <button className="btn danger" onClick={() => store.deleteSelection()}>Delete wire</button>
    </div>
  )
}

// ---------------------------------------------------------------- hardware part
function PartInspector({ p }: { p: HardwarePartData }) {
  const assistId = useId()
  const staticId = useId()
  const dirty = () => store.markHardwareDirty()
  const set = (patch: Partial<HardwarePartData['props']>) => {
    store.beginChange(`part:${p.id}:props`)
    Object.assign(p.props, patch)
    dirty()
  }
  return (
    <div className="side right insp">
      <h3>{p.kind}</h3>
      <TextField label="Name ID (binding key)" value={p.name} onChange={(v) => { store.beginChange(`part:${p.id}:name`); p.name = uniqueRename(p.id, p.name, v); dirty() }} />
      <div className="row2">
        <NumField label="X" value={Math.round(p.x)} step={5} onChange={(v) => { store.beginChange(`part:${p.id}:xy`); p.x = v; dirty() }} />
        <NumField label="Y" value={Math.round(p.y)} step={5} onChange={(v) => { store.beginChange(`part:${p.id}:xy`); p.y = v; dirty() }} />
      </div>
      <div className="row2">
        <NumField label="Z (depth)" value={Math.round(p.z ?? 0)} step={5} onChange={(v) => { store.beginChange(`part:${p.id}:z`); p.z = v; dirty() }} />
        <NumField label="Thickness" value={Math.round(p.props.depth ?? 0)} step={2} min={0} onChange={(v) => set({ depth: v > 0 ? v : undefined })} />
      </div>
      {p.kind !== 'water' && (
        <SelectField
          label="Custom shape (Part Studio)"
          value={p.props.meshId ?? ''}
          options={store.project.hardware.meshes.map((m) => ({ v: m.id, label: m.name }))}
          allowEmpty="(kind default)"
          onChange={(v) => set({ meshId: v || undefined })}
        />
      )}
      <div className="row2">
        <NumField label="Angle°" value={Math.round(p.angle)} step={5} onChange={(v) => { store.beginChange(`part:${p.id}:angle`); p.angle = v; dirty() }} />
        <NumField label="Width" value={Math.round(p.w)} step={2} min={4} onChange={(v) => { store.beginChange(`part:${p.id}:size`); p.w = Math.max(4, v); dirty() }} />
      </div>
      {(p.kind === 'wheel' || p.kind === 'gear' || p.kind === 'duck') ? null : (
        <NumField label="Height" value={Math.round(p.h)} step={2} min={4} onChange={(v) => { store.beginChange(`part:${p.id}:size`); p.h = Math.max(4, v); dirty() }} />
      )}
      {p.kind === 'gear' && (
        <NumField label="Teeth" value={Math.round(Number(p.props.teeth ?? 12))} step={1} min={6} max={40} onChange={(v) => set({ teeth: Math.round(v) })} />
      )}
      {(p.kind === 'gear' || p.kind === 'wheel' || p.kind === 'duck') && (
        <NumField label="Collision radius (0 = visual size)" value={p.props.collisionR ?? 0} step={1} min={0} onChange={(v) => set({ collisionR: v > 0 ? v : undefined })} />
      )}
      {(p.kind === 'chassis' || p.kind === 'board') && (
        <div className="field checkrow">
          <input id={assistId} type="checkbox" checked={p.props.assist === true} onChange={(e) => set({ assist: e.target.checked || undefined })} />
          <label htmlFor={assistId}>Flight assist (weathervane stability)</label>
        </div>
      )}
      <SelectField
        label="Material"
        value={p.props.material ?? ''}
        options={['wood', 'steel', 'iron', 'acrylic', 'rubber', 'plastic', 'organic']}
        allowEmpty="(kind default)"
        onChange={(v) => set({ material: (v || undefined) as never })}
      />
      <TextField label="Color override" value={p.props.color ?? ''} onChange={(v) => set({ color: v || undefined })} />
      <div className="field checkrow">
        <input id={staticId} type="checkbox" checked={p.props.isStatic === true} onChange={(e) => set({ isStatic: e.target.checked || undefined })} />
        <label htmlFor={staticId}>Static (anchored to the world)</label>
      </div>
      <SelectField
        label="Bound circuit component"
        value={p.props.boundComponent ?? ''}
        options={[...new Set(compatibleCircuitsForPart(p).map((c) => c.name))].sort()}
        allowEmpty="(none)"
        onChange={(v) => set({ boundComponent: v || undefined })}
      />
      {p.props.boundComponent && !compatibleCircuitsForPart(p).some((c) => c.name === p.props.boundComponent) && (
        <div className="warn">“{p.props.boundComponent}” is not a compatible circuit source for this {p.kind}.</div>
      )}
      {(p.kind === 'thruster' || p.kind === 'propeller' || p.kind === 'emitter' || p.kind === 'ledBulb') && (
        <NumField label="Facing offset°" value={p.props.direction ?? 0} step={5} onChange={(v) => set({ direction: v })} />
      )}
      {(p.kind === 'thruster' || p.kind === 'propeller') && (
        <NumField label="Force scale" value={p.props.force ?? (p.kind === 'thruster' ? 1 : 0.9)} step={0.1} min={0} onChange={(v) => set({ force: Math.max(0, v) })} />
      )}
      {p.kind === 'emitter' && (
        <NumField label="Flow rate (drops/s)" value={p.props.rate ?? 8} step={1} min={0} max={40} onChange={(v) => set({ rate: Math.max(0, v) })} />
      )}
      {p.kind === 'water' && (
        <>
          <NumField label="Fluid density" value={p.props.density ?? 0.001} step={0.0002} min={0.0001} onChange={(v) => set({ density: v })} />
          <div className="row2">
            <NumField label="Flow X" value={p.props.flowX ?? 0} step={0.1} onChange={(v) => set({ flowX: v })} />
            <NumField label="Flow Y" value={p.props.flowY ?? 0} step={0.1} onChange={(v) => set({ flowY: v })} />
          </div>
          <div className="help-text">
            Flowing water entrains bodies (millraces, rivers). Still water floats ducks.
          </div>
        </>
      )}
      <div className="row2" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => duplicatePart(p)}>Duplicate</button>
        <button className="btn danger" onClick={() => store.deleteSelection()}>Delete</button>
      </div>
    </div>
  )
}

function duplicatePart(p: HardwarePartData) {
  store.beginChange(`duplicate:${p.id}`)
  const copy: HardwarePartData = {
    ...p,
    id: `${p.id}_copy_${Math.floor(Math.random() * 1e6)}`,
    name: uniqueRename('', '', p.name),
    x: p.x + 40,
    y: p.y + 40,
    props: { ...p.props },
  }
  store.project.hardware.parts.push(copy)
  store.setSelection({ kind: 'part', id: copy.id })
  store.markHardwareDirty()
}

// ---------------------------------------------------------------- joint
function JointInspector({ j }: { j: JointData }) {
  const dirty = () => store.markHardwareDirty()
  const set = (patch: Partial<JointData['props']>) => {
    store.beginChange(`joint:${j.id}:props`)
    Object.assign(j.props, patch)
    dirty()
  }
  const a = store.partById(j.a)
  const b = store.partById(j.b)
  const motorJoints = store.project.hardware.joints.filter((x) => x.type === 'motor' && x.id !== j.id)
  const moveAnchorBToA = () => {
    if (!a || !b) return
    store.beginChange(`joint:${j.id}:anchor`)
    const aW = partLocalToWorld(a, j.ax, j.ay)
    const local = worldToPartLocal(b, new THREE.Vector3(aW.x, aW.y, aW.z))
    j.bx = Math.round(local.x * 100) / 100
    j.by = Math.round(local.y * 100) / 100
    dirty()
  }
  const anchor = (side: 'a' | 'b', key: 'x' | 'y') => {
    const tag = `joint:${j.id}:anchor${side}${key}`
    return (v: number) => {
      store.beginChange(tag)
      if (side === 'a') { if (key === 'x') j.ax = v; else j.ay = v }
      else { if (key === 'x') j.bx = v; else j.by = v }
      dirty()
    }
  }
  return (
    <div className="side right insp">
      <h3>{j.type} joint</h3>
      <div className="field">
        <div className="field-label">Between</div>
        <div>{a?.name ?? '?'} ↔ {b?.name ?? '?'}</div>
      </div>
      {j.type !== 'weld' && (
        <>
          <div className="row2">
            <NumField label="A anchor X" value={Math.round(j.ax * 100) / 100} step={5} onChange={anchor('a', 'x')} />
            <NumField label="A anchor Y" value={Math.round(j.ay * 100) / 100} step={5} onChange={anchor('a', 'y')} />
          </div>
          <div className="row2">
            <NumField label="B anchor X" value={Math.round(j.bx * 100) / 100} step={5} onChange={anchor('b', 'x')} />
            <NumField label="B anchor Y" value={Math.round(j.by * 100) / 100} step={5} onChange={anchor('b', 'y')} />
          </div>
          {j.type !== 'slider' && (
            <>
              <button className="btn" onClick={moveAnchorBToA}>Align B anchor onto A</button>
              <p className="help-text">Hinge anchors of both parts should meet at one point, or the solver yanks the assembly at start.</p>
            </>
          )}
        </>
      )}
      {j.type === 'motor' && (
        <>
          <SelectField
            label="Bound circuit motor"
            value={j.props.boundComponent ?? ''}
            options={[...new Set(compatibleCircuitsForJoint(j).map((c) => c.name))].sort()}
            allowEmpty="(none — free spin)"
            onChange={(v) => set({ boundComponent: v || undefined })}
          />
          {j.props.boundComponent && !compatibleCircuitsForJoint(j).some((c) => c.name === j.props.boundComponent) && (
            <div className="warn">“{j.props.boundComponent}” is not a motor or fan component.</div>
          )}
          <NumField label="Max accel (rad/s²)" value={j.props.maxAccel ?? 34} step={2} min={1} onChange={(v) => set({ maxAccel: Math.max(1, v) })} />
          <div className="row2">
            <NumField label="Min angle°" value={j.props.minAngle ?? 0} step={5} onChange={(v) => set({ minAngle: v })} />
            <NumField label="Max angle°" value={j.props.maxAngle ?? 0} step={5} onChange={(v) => set({ maxAngle: v })} />
          </div>
          <div className="help-text">
            The rotor (second part) spins toward V/ke of the bound motor. Equal limits = locked; leave both at 0 for
            free rotation.
          </div>
        </>
      )}
      {j.type === 'pin' && (
        <div className="row2">
          <NumField label="Min angle°" value={j.props.minAngle ?? 0} step={5} onChange={(v) => set({ minAngle: v })} />
          <NumField label="Max angle°" value={j.props.maxAngle ?? 0} step={5} onChange={(v) => set({ maxAngle: v })} />
        </div>
      )}
      {j.type === 'slider' && (
        <>
          <NumField label="Axis° (0=+x, 90=down)" value={j.props.axis ?? 90} step={5} onChange={(v) => set({ axis: v })} />
          <NumField label="Rack ratio (px/rad)" value={j.props.ratio ?? 6} step={0.5} onChange={(v) => set({ ratio: v })} />
          <SelectField
            label="Driven by motor joint"
            value={j.props.driveBy ?? ''}
            options={motorJoints.map((x) => {
              const pa = store.partById(x.a)
              const pb = store.partById(x.b)
              return { v: x.id, label: `${pa?.name ?? '?'} → ${pb?.name ?? '?'}` }
            })}
            allowEmpty="(free sliding)"
            onChange={(v) => set({ driveBy: v || undefined })}
          />
        </>
      )}
      <button className="btn danger" style={{ marginTop: 10 }} onClick={() => store.deleteSelection()}>Delete joint</button>
    </div>
  )
}

// ---------------------------------------------------------------- project
function ProjectInspector() {
  const issues = bindingDiagnostics(store.project)
  const solverWarnings = getCircuit().runtime.warnings
  const runtimeError = getRuntimeError()
  const p = store.project
  return (
    <div className="side right insp">
      <h3>Project</h3>
      <TextField label="Name" value={p.name} onChange={(v) => { p.name = v; store.notify() }} />
      <NumField label="Ground level Y" value={p.groundY} step={10} onChange={(v) => { store.beginChange('ground'); p.groundY = v; store.markHardwareDirty() }} />
      <div className="field">
        <div className="field-label">Contents</div>
        <div>
          {p.circuit.components.length} circuit parts · {p.circuit.wires.length} wires ·{' '}
          {p.hardware.parts.length} bodies · {p.hardware.joints.length} joints
        </div>
      </div>
      {issues.length > 0 && (
        <div className="warn">
          <b>Binding issues</b>
          {issues.map((m, i) => (
            <div key={i}>• {m}</div>
          ))}
        </div>
      )}
      {solverWarnings.length > 0 && (
        <div className="err">
          <b>Solver</b>
          {solverWarnings.map((m, i) => (
            <div key={i}>• {m}</div>
          ))}
        </div>
      )}
      {runtimeError && (
        <div className="err">
          <b>Runtime</b>
          <div>• {runtimeError}</div>
        </div>
      )}
      {issues.length === 0 && solverWarnings.length === 0 && !runtimeError && getCircuit().runtime.solved && (
        <div className="ok">All bindings resolve. Circuit solves cleanly.</div>
      )}
      <div className="help-text" style={{ marginBottom: 0 }}>
        Select anything on the canvas to edit it. Link circuit ⇄ hardware by matching Name IDs in either direction.
      </div>
    </div>
  )
}
