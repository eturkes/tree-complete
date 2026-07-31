import { useEffect } from 'react'

const BACKGROUND_SELECTOR = '.skip-link, .app-header, .sync-banner, .canvas, .toast'

interface ElementState {
  inert: boolean
  ariaHidden: string | null
}

export function useInertBackground(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const states = new Map<HTMLElement, ElementState>()
    const isolate = () => {
      for (const element of document.querySelectorAll<HTMLElement>(BACKGROUND_SELECTOR)) {
        if (!states.has(element)) {
          states.set(element, {
            inert: element.inert,
            ariaHidden: element.getAttribute('aria-hidden'),
          })
        }
        element.inert = true
        element.setAttribute('aria-hidden', 'true')
      }
    }
    isolate()
    const observer = new MutationObserver(isolate)
    const shell = document.querySelector('.app-shell')
    if (shell) observer.observe(shell, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const [element, state] of states) {
        element.inert = state.inert
        if (state.ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', state.ariaHidden)
      }
    }
  }, [active])
}
