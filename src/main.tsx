// ============================================================================
// SCHEMACHINE boot: store, runtime, global 60 Hz circuit tick, keyboard input,
// autosave, first render.
// ============================================================================

import { createRoot } from 'react-dom/client'
import { buildPreset } from './presets'
import { getCircuit, reportRuntimeFailure, tickRuntime } from './runtime'
import { initStore, store } from './store'
import { shouldIgnoreWorkspaceShortcut } from './ui/shortcuts'
import { autosave, getAutosaveStatus, loadAutosave } from './ui/io'
import App from './ui/App'
import { AudioKit } from './sim/audio'
import './styles.css'

const autosaved = loadAutosave()
if (autosaved) {
  initStore(autosaved)
} else {
  initStore(buildPreset('computer')!)
}
// Prime the engine so first paint already shows solved voltages.
tickRuntime()
if (autosaved) {
  setTimeout(() => store.toast('Restored autosave from this browser', 'info'), 600)
} else {
  const status = getAutosaveStatus()
  if (status.state === 'error') {
    setTimeout(() => store.toast(status.message, 'error'), 600)
  }
}

// Global 60 Hz circuit loop — runs in every view (schematic stays live).
setInterval(() => {
  tickRuntime()
}, 1000 / 60)

// Autosave.
setInterval(() => autosave(store.project), 20000)
window.addEventListener('beforeunload', () => autosave(store.project))

// Global keyboard switch bindings. Workspace shortcuts stay suspended while
// dialogs are open or an interactive control has focus. Key releases always
// run so a held switch can never stick.
window.addEventListener('keydown', (e) => {
  if (shouldIgnoreWorkspaceShortcut(e)) return
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
  AudioKit.unlock()
  try {
    getCircuit().keyDown(e.code)
  } catch (error) {
    reportRuntimeFailure(error)
  }
})
window.addEventListener('keyup', (e) => {
  try {
    getCircuit().keyUp(e.code)
  } catch (error) {
    reportRuntimeFailure(error)
  }
})
window.addEventListener('blur', () => {
  try {
    getCircuit().clearTransientInputs()
  } catch (error) {
    reportRuntimeFailure(error)
  }
})

createRoot(document.getElementById('root')!).render(<App />)
