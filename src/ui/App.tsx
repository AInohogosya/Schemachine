import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PRESETS } from '../presets'
import { getCircuit, getRuntimeError, getRuntimeRevision, subscribeRuntime, tickRuntime } from '../runtime'
import { emptyProject, store } from '../store'
import type { ProjectData } from '../types'
import { downloadProject, getAutosaveStatus, parseProjectFile, subscribeAutosave } from './io'
import HardwareView from './HardwareView'
import InspectorPanel from './InspectorPanel'
import LibraryPanel from './LibraryPanel'
import PartStudioView from './PartStudioView'
import SchematicView from './SchematicView'
import SimulationView from './SimulationView'
import Toolbar from './Toolbar'

type Modal = 'presets' | 'help' | 'replace' | null

type PendingReplacement = {
  title: string
  success: string
  build: () => ProjectData
}

export default function App() {
  useSyncExternalStore(store.subscribe, () => store.view + store.toasts.length)
  const [modal, setModal] = useState<Modal>(null)
  const [pending, setPending] = useState<PendingReplacement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!modal) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const background = document.querySelectorAll<HTMLElement>('.toolbar, .main, .statusbar')
    background.forEach((element) => { element.inert = true })
    try {
      getCircuit().clearTransientInputs()
    } catch {
      return
    }
    const dialog = document.querySelector<HTMLElement>('[aria-modal="true"]')
    const focusableElements = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getAttribute('aria-hidden') !== 'true')
      : []
    const initial = dialog?.querySelector<HTMLElement>('[data-initial-focus]') ?? focusableElements()[0] ?? dialog
    initial?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setModal(null)
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const items = focusableElements()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      background.forEach((element) => { element.inert = false })
      if (previous?.isConnected) previous.focus()
    }
  }, [modal])

  const loadIntoStore = (name: string, project: ProjectData) => {
    store.loadProject(project)
    store.setView('schematic')
    tickRuntime()
    store.toast(name, 'ok')
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (document.querySelector('.modal-back')) return
      event.preventDefault()
      if (key === 'y' || event.shiftKey) store.redo()
      else store.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const requestReplacement = (replacement: PendingReplacement) => {
    setPending(replacement)
    setModal('replace')
  }

  const confirmReplacement = () => {
    if (!pending) return
    try {
      loadIntoStore(pending.success, pending.build())
      setPending(null)
      setModal(null)
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Could not load project', 'error')
    }
  }

  const onSave = () => {
    downloadProject(store.project)
    store.toast('Project exported as a .schemachine.json file.', 'ok')
  }

  const onLoadFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const project = parseProjectFile(String(reader.result ?? ''))
        requestReplacement({ title: `Open “${project.name}”?`, success: `Loaded “${project.name}”`, build: () => project })
      } catch (error) {
        store.toast(error instanceof Error ? error.message : 'Could not load file', 'error')
      }
    }
    reader.onerror = () => store.toast('The selected file could not be read.', 'error')
    reader.readAsText(file)
  }

  return (
    <div className="app">
      <Toolbar onPresets={() => setModal('presets')} onSave={onSave} onLoad={() => fileRef.current?.click()} onBlank={() => requestReplacement({ title: 'Start a new project?', success: 'New blank project ready', build: () => emptyProject('Untitled Machine') })} onHelp={() => setModal('help')}/>
      <div className="main">
        <LibraryPanel/>
        {store.view === 'schematic' && <SchematicView/>}
        {store.view === 'hardware' && <HardwareView/>}
        {store.view === 'sim' && <SimulationView/>}
        {store.view === 'studio' && <PartStudioView/>}
        {store.view !== 'studio' && <InspectorPanel/>}
      </div>
      <StatusBar/>
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {store.toasts.map((toast) => <div key={toast.id} className={'toast ' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.text}</div>)}
      </div>
      <input ref={fileRef} type="file" accept=".schemachine.json,.fable.json,application/json,.json" hidden aria-label="Open SCHEMACHINE project" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onLoadFile(file)
        event.target.value = ''
      }}/>
      {modal === 'presets' && (
        <div className="modal-back" onClick={() => setModal(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="presets-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <button className="icon-btn modal-close" onClick={() => setModal(null)} aria-label="Close presets">×</button>
            <h2 id="presets-title">Preset machines</h2>
            <p>{PRESETS.length} complete projects with solved circuits connected to simulated 3D hardware. You will review the replacement before a preset opens.</p>
            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button key={preset.id} className="preset-card" onClick={() => requestReplacement({
                  title: `Load “${preset.title}”?`,
                  success: `Loaded preset “${preset.title}”`,
                  build: () => preset.build(),
                })}>
                  <b>{preset.title}</b><span>{preset.blurb}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {modal === 'replace' && pending && (
        <div className="modal-back" onClick={() => setModal(null)}>
          <section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="replace-title" aria-describedby="replace-description" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <h2 id="replace-title">{pending.title}</h2>
            <p id="replace-description">This replaces the current workspace. Export the project first if you want a separate copy.</p>
            <div className="modal-actions"><button className="btn" data-initial-focus onClick={() => setModal(null)}>Keep current project</button><button className="btn primary" onClick={confirmReplacement}>Replace workspace</button></div>
          </section>
        </div>
      )}
      {modal === 'help' && <HelpModal onClose={() => setModal(null)}/>} 
    </div>
  )
}

function StatusBar() {
  useSyncExternalStore(store.subscribe, () => store.circuitRev + store.hardwareRev + store.view + store.selection.id)
  useSyncExternalStore(subscribeRuntime, getRuntimeRevision)
  useSyncExternalStore(subscribeAutosave, getAutosaveStatus)
  const runtime = getCircuit().runtime
  const runtimeError = getRuntimeError()
  const save = getAutosaveStatus()
  const project = store.project
  const warnings = runtime.warnings.length
  const circuitStatus = runtimeError
    ? 'Circuit: update fault'
    : runtime.solved
      ? warnings ? `Circuit: ${warnings} warning${warnings === 1 ? '' : 's'}` : 'Circuit: ready'
      : 'Circuit: solver fault'
  const saveStatus = save.state === 'error'
    ? 'Autosave unavailable · Save exports a file'
    : save.state === 'saved' && save.time
      ? `Autosaved locally at ${new Date(save.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : save.state === 'restored'
        ? 'Autosave restored · Save exports a file'
        : 'Local autosave every 20 seconds · Save exports a file'
  return (
    <footer className="statusbar">
      <span className={'status-state ' + (!runtimeError && runtime.solved && !warnings ? 'good' : 'bad')} title={runtimeError ?? runtime.warnings.join('\n')}>{circuitStatus}</span>
      <span>{project.circuit.components.length} components · {project.circuit.wires.length} wires · {project.hardware.parts.length} bodies · {project.hardware.joints.length} joints</span>
      <span className="spacer"/>
      <span className={'status-save' + (save.state === 'error' ? ' bad' : '')} title={save.message}>{saveStatus}</span>
    </footer>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close manual">×</button>
        <h2 id="help-title">SCHEMACHINE manual</h2>
        <h4>Find and place components</h4>
        <p>Browse by function or search by a part name, synonym, or abbreviation. Press <kbd>/</kbd> to focus search, star frequently used parts, and use the category filter to narrow the library. Select a component and click the canvas to place it; Shift-click places several copies.</p>
        <h4>Circuit schematic</h4>
        <p>Drag from one pin to another to draw a wire. Muted green indicates logic HIGH, gray is LOW, amber is an intermediate voltage, and dashed red indicates an overload. Drag components to move them, click switches to operate them, and use the canvas controls to fit, zoom, or hide the grid. Unconnected logic inputs are marked and treated as LOW.</p>
        <h4>Keyboard control</h4>
        <p>Select a push-button or slide switch and assign a key in the inspector. Push-buttons remain closed while held; slide switches toggle on each press. Bindings also work in the 3D simulation.</p>
        <h4>Assembly and simulation</h4>
        <p>Place bodies and connect them with welds, hinges, motor hinges, or sliders. A translucent ghost previews where a part will land; Shift-click places several copies. Drag parts to move them (hold <kbd>Shift</kbd> to lock to an axis), nudge with the arrow keys, adjust depth with <kbd>Q</kbd>/<kbd>E</kbd>, rotate with <kbd>R</kbd> or fine-tune with <kbd>[</kbd>/<kbd>]</kbd>, and press <kbd>F</kbd> to fit the view. The outline in the left panel lists every body and joint for easy selection. When jointing, the second anchor snaps onto the first when clicked close, and anchors can be corrected numerically in the inspector. Undo mistakes with <kbd>Ctrl</kbd>+<kbd>Z</kbd> and redo with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>. Link physical fixtures and motor joints to circuit components by name in the inspector.</p>
        <h4>Part Studio</h4>
        <p>Create a plate, cylinder, or sphere, then sculpt indents and bulges. STL files can be imported and sculpted. Assign finished shapes to hardware parts with the Apply control or the part inspector.</p>
        <h4>Electrical model</h4>
        <p>The solver includes linear and nonlinear components, transient capacitor/inductor models, motor back-EMF, and protection behavior. Batteries trip after a dead short and retry automatically; blown fuses must be replaced explicitly.</p>
        <div className="modal-actions"><button className="btn primary" onClick={onClose}>Start building</button></div>
      </section>
    </div>
  )
}
