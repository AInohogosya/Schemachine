import { useSyncExternalStore } from 'react'
import { store, type ViewMode } from '../store'

const TABS: { id: ViewMode; label: string; step: string }[] = [
  { id: 'schematic', label: 'Circuit', step: '01' },
  { id: 'hardware', label: 'Assembly', step: '02' },
  { id: 'sim', label: 'Simulation', step: '03' },
  { id: 'studio', label: 'Part Studio', step: '04' },
]

function ActionIcon({ name }: { name: 'presets' | 'open' | 'save' | 'new' | 'help' | 'undo' | 'redo' }) {
  if (name === 'save') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 3h10l3 3v11H3V3h1Zm3 0v5h7V3M7 17v-5h7v5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
  if (name === 'open') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.5 6.5h6l2-2h7v12h-15v-10Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M2.5 9h15" stroke="currentColor" strokeWidth="1.4"/></svg>
  if (name === 'new') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 2.5h7l4 4v11H5v-15Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M12 2.5v4h4M10 9v5m-2.5-2.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
  if (name === 'help') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.8 7.4c.2-1.3 1.1-2 2.4-2 1.4 0 2.4.8 2.4 2 0 1.9-2.4 2-2.4 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="10.2" cy="14.3" r=".8" fill="currentColor"/></svg>
  if (name === 'undo') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.5 4.5 4 8l3.5 3.5M4 8h8a4.5 4.5 0 0 1 0 9H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
  if (name === 'redo') return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4.5 16 8l-3.5 3.5M16 8H8a4.5 4.5 0 0 0 0 9h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/></svg>
}

export default function Toolbar(props: {
  onPresets: () => void
  onSave: () => void
  onLoad: () => void
  onBlank: () => void
  onHelp: () => void
}) {
  useSyncExternalStore(store.subscribe, () => store.view + store.project.name + store.historyRev)
  const actions = [
    { name: 'presets' as const, label: 'Presets', onClick: props.onPresets },
    { name: 'open' as const, label: 'Open', onClick: props.onLoad },
    { name: 'new' as const, label: 'New', onClick: props.onBlank },
    { name: 'help' as const, label: 'Help', onClick: props.onHelp },
  ]
  return (
    <header className="toolbar">
      <div className="logo">Schema<span>Machine</span><small>Workbench</small></div>
      <nav className="tabs" aria-label="Workspace views">
        {TABS.map((tab) => (
          <button key={tab.id} className={'tab' + (store.view === tab.id ? ' active' : '')} onClick={() => store.setView(tab.id)} aria-current={store.view === tab.id ? 'page' : undefined}>
            <span className="step">{tab.step}</span>{tab.label}
          </button>
        ))}
      </nav>
      <div className="spacer"/>
      <span className="projname" title={store.project.name}>{store.project.name}</span>
      <div className="toolbar-actions">
        <button className="btn" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><span className="action-icon"><ActionIcon name="undo"/></span><span className="action-label">Undo</span></button>
        <button className="btn" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><span className="action-icon"><ActionIcon name="redo"/></span><span className="action-label">Redo</span></button>
        {actions.map((action) => <button className="btn" key={action.name} onClick={action.onClick} title={action.label}><span className="action-icon"><ActionIcon name={action.name}/></span><span className="action-label">{action.label}</span></button>)}
        <button className="btn primary" onClick={props.onSave} title="Export project"><span className="action-icon"><ActionIcon name="save"/></span><span className="action-label">Save</span></button>
      </div>
    </header>
  )
}
