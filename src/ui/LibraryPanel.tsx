import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { COMPONENT_DEFS } from '../circuit/components'
import { CATEGORY_LABELS, CATEGORY_ORDER, CIRCUIT_CATALOG, searchCatalog, type CatalogEntry } from '../circuit/catalog'
import { getCircuit } from '../runtime'
import { store } from '../store'
import { PART_LABELS } from './HardwareView'
import { shouldIgnoreWorkspaceShortcut } from './shortcuts'

const PART_GROUPS = [
  { title: 'Structural', kinds: ['board', 'chassis', 'axle'], keywords: 'frame beam support mount rail' },
  { title: 'Motion & flight', kinds: ['wheel', 'gear', 'propeller', 'wing'], keywords: 'vehicle drive rotor fan tire airframe' },
  { title: 'Objects', kinds: ['duck', 'block', 'deco', 'plant', 'batteryPack'], keywords: 'crate decoration power object' },
  { title: 'Electrical hardware', kinds: ['ledBulb', 'switchPad', 'speaker', 'thruster', 'emitter'], keywords: 'lamp light switch sound rocket water nozzle' },
  { title: 'Environment', kinds: ['water'], keywords: 'fluid river reservoir flow liquid' },
]

const PART_CHIP: Record<string, string> = {
  board: '#9a7658', chassis: '#7c8c96', wheel: '#48545a', gear: '#84939a', propeller: '#65777e',
  wing: '#88a8b2', axle: '#87959a', duck: '#c5a648', block: '#8d839b', deco: '#a98796', plant: '#65876b',
  thruster: '#65777e', ledBulb: '#c7ad67', switchPad: '#5c8872', speaker: '#536168', batteryPack: '#587c68',
  emitter: '#6e929e', water: '#6e9fac',
}

const JOINT_TOOLS = [
  { type: 'weld', label: 'Weld', hint: 'Lock two parts into one rigid assembly' },
  { type: 'pin', label: 'Pin hinge', hint: 'Allow free rotation around an anchor' },
  { type: 'motor', label: 'Motor hinge', hint: 'Drive rotation with a named circuit motor' },
  { type: 'slider', label: 'Slider rail', hint: 'Constrain motion to a linear axis' },
]

function AssemblyOutline() {
  useSyncExternalStore(store.subscribe, () => store.hardwareRev + store.selection.kind + store.selection.id)
  const parts = store.project.hardware.parts
  const joints = store.project.hardware.joints
  if (parts.length === 0 && joints.length === 0) return null
  const partName = (id: string) => store.partById(id)?.name ?? '?'
  return (
    <details className="lib-group" open>
      <summary>Outline<span className="count">{parts.length + joints.length}</span></summary>
      <div className="lib-group-items">
        {parts.map((p) => (
          <div className={'lib-row' + (store.selection.kind === 'part' && store.selection.id === p.id ? ' armed' : '')} key={p.id}>
            <button className="lib-item" onClick={() => store.setSelection({ kind: 'part', id: p.id })} title="Select in the 3D view">
              <span className="chip" style={{ background: PART_CHIP[p.kind] ?? '#8a999e' }}/>
              <span className="lib-item-copy">
                <span className="lib-item-name">{p.name}</span>
                <span className="lib-item-description">{PART_LABELS[p.kind] ?? p.kind}</span>
              </span>
            </button>
          </div>
        ))}
        {joints.map((j) => (
          <div className={'lib-row' + (store.selection.kind === 'joint' && store.selection.id === j.id ? ' armed' : '')} key={j.id}>
            <button className="lib-item" onClick={() => store.setSelection({ kind: 'joint', id: j.id })} title="Select joint">
              <span className="chip"/>
              <span className="lib-item-copy">
                <span className="lib-item-name">{j.type} joint</span>
                <span className="lib-item-description">{partName(j.a)} ↔ {partName(j.b)}</span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
}

function StarIcon({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} aria-hidden="true"><path d="m10 2.8 2.15 4.35 4.8.7-3.48 3.38.82 4.78L10 13.76 5.71 16l.82-4.78-3.48-3.38 4.8-.7L10 2.8Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/></svg>
}

function ComponentGlyph({ entry }: { entry: CatalogEntry }) {
  const type = entry.type
  let content
  if (type === 'capacitor') content = <><path d="M3 10h6m6 0h6M9 5v10m6-10v10"/></>
  else if (type === 'inductor') content = <><path d="M2 14h3c0-6 4-6 4 0 0-6 4-6 4 0 0-6 4-6 4 0h3"/></>
  else if (type === 'resistor' || type === 'potentiometer' || type === 'photoresistor' || type === 'thermistor' || type === 'fuse') content = <><path d="M2 14h3l2-5 4 10 4-10 2 5h3"/></>
  else if (type === 'battery' || type === 'currentSource') content = <><path d="M10 2v5m0 10v5M5 7h10M7 13h6"/></>
  else if (type === 'ground') content = <><path d="M10 3v8M4 11h12M6 15h8M8 19h4"/></>
  else if (type === 'switchPush' || type === 'switchSlide' || type === 'relay') content = <><path d="M3 17h4m10 0h-4M6 15 16 7"/><circle cx="6" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/></>
  else if (type === 'gate' || type === 'clock' || type === 'opAmp') content = <><path d="M6 5h7l5 7-5 7H6V5ZM2 9h4M2 15h4m12-2h4"/></>
  else if (type === 'diode' || type === 'schottky' || type === 'zenerDiode' || type === 'transistor' || type === 'mosfet') content = <><path d="m7 5 8 7-8 7V5Zm8 7h5M2 12h5m8-4v8"/></>
  else content = <><circle cx="11" cy="11" r="5"/><path d="M11 2V0m0 22v-2M2 11H0m22 0h-2M4.6 4.6 3.2 3.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M3.2 18.8l1.4-1.4"/></>
  return <svg className="component-glyph" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>
}

function readFavorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem('schemachine.componentFavorites') ?? localStorage.getItem('fablegame.componentFavorites') ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export default function LibraryPanel() {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const [recent, setRecent] = useState<string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const view = useSyncExternalStore(store.subscribe, () => store.view + (store.circuitPlacement ?? '') + (store.partPlacement ?? '') + (store.jointTool?.type ?? '') + (store.jointTool?.aId ?? ''))
  const activeView = store.view

  useEffect(() => {
    setQ('')
    setCategory('all')
    setFavoritesOnly(false)
  }, [activeView])

  useEffect(() => {
    try {
      localStorage.setItem('schemachine.componentFavorites', JSON.stringify(favorites))
    } catch {
      return
    }
  }, [favorites])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || shouldIgnoreWorkspaceShortcut(event)) return
      if (store.view !== 'schematic' && store.view !== 'hardware') return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => searchCatalog(CIRCUIT_CATALOG, q).filter((entry) => {
    if (category !== 'all' && COMPONENT_DEFS[entry.type].category !== category) return false
    if (favoritesOnly && !favorites.includes(entry.id)) return false
    return true
  }), [q, category, favoritesOnly, favorites])

  const toggleFavorite = (id: string) => {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const place = (entry: CatalogEntry) => {
    store.circuitPlacement = store.circuitPlacement === entry.id ? null : entry.id
    store.partPlacement = null
    store.jointTool = null
    setRecent((current) => [entry.id, ...current.filter((id) => id !== entry.id)].slice(0, 4))
    store.notify()
  }

  if (activeView === 'schematic') {
    const searching = q.trim().length > 0
    const entryRow = (entry: CatalogEntry) => {
      const favorite = favorites.includes(entry.id)
      return (
        <div className={'lib-row' + (store.circuitPlacement === entry.id ? ' armed' : '')} key={entry.id}>
          <button className="lib-item" onClick={() => place(entry)} aria-pressed={store.circuitPlacement === entry.id} title={`${entry.description} Click to place on the schematic.`}>
            <ComponentGlyph entry={entry}/>
            <span className="lib-item-copy">
              <span className="lib-item-name">{entry.label}</span>
              <span className="lib-item-description">{entry.description}</span>
            </span>
          </button>
          <button className={'icon-btn favorite-btn' + (favorite ? ' active' : '')} onClick={() => toggleFavorite(entry.id)} aria-label={`${favorite ? 'Remove' : 'Add'} ${entry.label} ${favorite ? 'from' : 'to'} favorites`} aria-pressed={favorite}>
            <StarIcon filled={favorite}/>
          </button>
        </div>
      )
    }
    return (
      <aside className="side" aria-label="Electronic component library">
        <h2 className="panel-heading">Components</h2>
        <p className="panel-subtitle">Select a part, then click the canvas. Press / to search.</p>
        <div className="search-wrap">
          <SearchIcon/>
          <input ref={searchRef} className="lib-search" type="search" placeholder="Name, function, or alias…" aria-label="Search electronic components" value={q} onChange={(event) => setQ(event.target.value)}/>
          {q && <button className="icon-btn search-clear" onClick={() => setQ('')} aria-label="Clear component search">×</button>}
        </div>
        <div className="lib-filters">
          <select aria-label="Filter component category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map((id) => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
          </select>
          <button className={'btn filter-toggle' + (favoritesOnly ? ' active' : '')} onClick={() => setFavoritesOnly((value) => !value)} aria-label="Show favorite components only" aria-pressed={favoritesOnly} title="Favorites only"><StarIcon filled={favoritesOnly}/></button>
        </div>
        <div className="lib-meta"><span>{filtered.length} of {CIRCUIT_CATALOG.length} parts</span>{(q || category !== 'all' || favoritesOnly) && <button className="text-button" onClick={() => { setQ(''); setCategory('all'); setFavoritesOnly(false) }}>Reset filters</button>}</div>
        {!searching && !favoritesOnly && category === 'all' && recent.length > 0 && (
          <details className="lib-group" open>
            <summary>Recently used <span className="count">{recent.length}</span></summary>
            <div className="lib-group-items">{recent.map((id) => CIRCUIT_CATALOG.find((entry) => entry.id === id)).filter((entry): entry is CatalogEntry => Boolean(entry)).map(entryRow)}</div>
          </details>
        )}
        {searching || category !== 'all' || favoritesOnly ? filtered.map(entryRow) : CATEGORY_ORDER.map((cat, index) => {
          const entries = filtered.filter((entry) => COMPONENT_DEFS[entry.type].category === cat)
          if (entries.length === 0) return null
          return (
            <details className="lib-group" key={cat} open={index < 3}>
              <summary>{CATEGORY_LABELS[cat]} <span className="count">{entries.length}</span></summary>
              <div className="lib-group-items">{entries.map(entryRow)}</div>
            </details>
          )
        })}
        {filtered.length === 0 && <div className="lib-empty"><b>No matching components</b>Try a broader term such as “sensor,” “switch,” or “light,” or reset the filters.</div>}
        <details className="lib-group">
          <summary>Wire color guide</summary>
          <div className="lib-group-items legend">
            <div className="legend-row"><span className="legend-line high"/>Logic high</div>
            <div className="legend-row"><span className="legend-line"/>Low / inactive</div>
            <div className="legend-row"><span className="legend-line analog"/>Intermediate voltage</div>
            <div className="legend-row"><span className="legend-line hot"/>Overload or short</div>
          </div>
        </details>
      </aside>
    )
  }

  if (activeView === 'hardware') {
    const query = q.trim().toLowerCase()
    const groups = PART_GROUPS.map((group) => ({
      ...group,
      kinds: group.kinds.filter((kind) => !query || `${PART_LABELS[kind] ?? kind} ${kind} ${group.keywords}`.toLowerCase().includes(query)),
    })).filter((group) => group.kinds.length > 0)
    const joints = JOINT_TOOLS.filter((joint) => !query || `${joint.label} ${joint.hint}`.toLowerCase().includes(query))
    const resultCount = groups.reduce((sum, group) => sum + group.kinds.length, 0) + joints.length
    return (
      <aside className="side" aria-label="Hardware part library">
        <h2 className="panel-heading">Assembly parts</h2>
        <p className="panel-subtitle">Physical bodies, electrical fixtures, and joints.</p>
        <div className="search-wrap"><SearchIcon/><input ref={searchRef} className="lib-search" type="search" placeholder="Search assembly parts…" aria-label="Search assembly parts" value={q} onChange={(event) => setQ(event.target.value)}/>{q && <button className="icon-btn search-clear" onClick={() => setQ('')} aria-label="Clear part search">×</button>}</div>
        <div className="lib-meta"><span>{resultCount} tools</span>{q && <button className="text-button" onClick={() => setQ('')}>Clear search</button>}</div>
        <AssemblyOutline/>
        {groups.map((group) => (
          <details className="lib-group" key={group.title} open={Boolean(query) || group.title === 'Structural'}>
            <summary>{group.title}<span className="count">{group.kinds.length}</span></summary>
            <div className="lib-group-items">{group.kinds.map((kind) => (
              <div className={'lib-row' + (store.partPlacement === kind ? ' armed' : '')} key={kind}>
                <button className="lib-item" onClick={() => { store.partPlacement = store.partPlacement === kind ? null : kind; store.jointTool = null; store.notify() }} aria-pressed={store.partPlacement === kind}>
                  <span className="chip" style={{ background: PART_CHIP[kind] ?? '#8a999e' }}/><span className="lib-item-name">{PART_LABELS[kind] ?? kind}</span>
                </button>
              </div>
            ))}</div>
          </details>
        ))}
        {joints.length > 0 && <details className="lib-group" open={Boolean(query)}><summary>Joints<span className="count">{joints.length}</span></summary><div className="lib-group-items">{joints.map((joint) => (
          <div className={'lib-row' + (store.jointTool?.type === joint.type ? ' armed' : '')} key={joint.type}>
            <button className="lib-item" title={joint.hint} onClick={() => { store.jointTool = store.jointTool?.type === joint.type ? null : { type: joint.type, aId: '', ax: 0, ay: 0 }; store.partPlacement = null; store.notify() }} aria-pressed={store.jointTool?.type === joint.type}>
              <span className="chip"/><span className="lib-item-copy"><span className="lib-item-name">{joint.label}</span><span className="lib-item-description">{joint.hint}</span></span>
            </button>
          </div>
        ))}</div></details>}
        {resultCount === 0 && <div className="lib-empty"><b>No matching assembly tools</b>Try “wheel,” “light,” “structure,” or “joint.”</div>}
        <p className="lib-note">To join parts, select a joint and click two bodies at their attachment points.</p>
      </aside>
    )
  }

  if (activeView === 'sim') return <SignalMonitor/>
  return <StudioLibrary/>
}

function StudioLibrary() {
  useSyncExternalStore(store.subscribe, () => (store.studioMeshId ?? '') + store.hardwareRev)
  return (
    <aside className="side" aria-label="Custom shape library">
      <h2 className="panel-heading">Shape library</h2>
      <p className="panel-subtitle">Reusable parametric meshes for hardware parts.</p>
      {store.project.hardware.meshes.length === 0 && <div className="lib-empty"><b>No custom shapes yet</b>Create a plate, cylinder, or sphere, or import an STL from the canvas controls.</div>}
      {store.project.hardware.meshes.map((mesh) => (
        <div className={'lib-row' + (store.studioMeshId === mesh.id ? ' armed' : '')} key={mesh.id}>
          <button className="lib-item" onClick={() => { store.studioMeshId = mesh.id; store.notify() }}>
            <span className="chip"/><span className="lib-item-copy"><span className="lib-item-name">{mesh.name}</span><span className="lib-item-description">{mesh.ops.length} stamps{mesh.stl ? ` · ${mesh.stl.triangleCount} triangles` : ''}</span></span>
          </button>
        </div>
      ))}
      <div className="lib-cat">Sculpting</div>
      <p className="lib-note">Drag across the surface to indent or bulge it. Every stamp remains editable and is saved with the project.</p>
    </aside>
  )
}

function SignalMonitor() {
  useSyncExternalStore(store.subscribe, () => store.view)
  return (
    <aside className="side" aria-label="Live circuit signals">
      <h2 className="panel-heading">Live signals</h2>
      <p className="panel-subtitle">Circuit state updates while the simulation runs.</p>
      <LiveSignalList/>
      <div className="lib-cat">Controls</div>
      <p className="lib-note">Click switch pads on the model or use their keyboard bindings. Drag loose bodies to throw them. Playback and gravity controls are above the canvas.</p>
    </aside>
  )
}

function LiveSignalList() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 250)
    return () => clearInterval(id)
  }, [])
  const engine = getCircuit()
  const components = store.project.circuit.components
  if (components.length === 0) return <div className="lib-empty">No circuit components to monitor.</div>
  return <div>{components.map((component) => {
    const state = engine.runtime.states.get(component.id)
    const active = state?.active ?? 0
    const hot = Boolean(state?.overloaded || state?.tripped || state?.blown)
    let extra = COMPONENT_DEFS[component.type]?.label ?? component.type
    if (typeof state?.voltage === 'number') extra = `${state.voltage.toFixed(1)} V`
    else if (typeof state?.current === 'number') extra = `${(state.current * 1000).toFixed(0)} mA`
    else if (typeof state?.out === 'number') extra = state.out ? 'HIGH' : 'LOW'
    if (state?.tripped) extra = 'TRIPPED'
    if (state?.blown) extra = 'BLOWN'
    return <div className="sigrow" key={component.id} title={COMPONENT_DEFS[component.type]?.label}><span className={'dot' + (hot ? ' hot' : active > 0.03 ? ' on' : '')}/><span className="nm">{component.name}</span><span className="sig-value">{extra}</span></div>
  })}</div>
}
