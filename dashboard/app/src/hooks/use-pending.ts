import { useEffect, useState } from "react"

/** True once `pending` has lasted past `delay`, so a one-frame read never flashes a skeleton. */
export function usePending(pending: boolean, delay = 150): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!pending) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(timer)
  }, [pending, delay])
  return shown
}

/** True once `pending` has held past `ms`, so a hung read degrades to the real controls instead of a permanent skeleton. */
export function useStuckPending(pending: boolean, ms = 6000): boolean {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!pending) {
      setStuck(false)
      return
    }
    const timer = window.setTimeout(() => setStuck(true), ms)
    return () => window.clearTimeout(timer)
  }, [pending, ms])
  return stuck
}
