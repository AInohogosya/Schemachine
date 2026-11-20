export function shouldIgnoreWorkspaceShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true
  if (typeof document !== 'undefined' && document.querySelector('.modal-back')) return true
  const target = event.target
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]'))
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
