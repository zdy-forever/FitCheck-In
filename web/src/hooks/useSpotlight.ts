import { useCallback, useRef } from 'react'

/**
 * Returns pointer handlers that write the pointer position into --mx / --my on the element,
 * used by the `.spotlight` CSS utility. Throttled to one write per animation frame; no-op on
 * touch-only devices.
 */
export function useSpotlight<T extends HTMLElement>() {
  const frame = useRef(0)
  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const { clientX, clientY } = e
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${clientX - r.left}px`)
      el.style.setProperty('--my', `${clientY - r.top}px`)
    })
  }, [])
  return { onPointerMove }
}
