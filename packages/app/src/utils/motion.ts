export const MOTION_DURATION_FAST_TOKEN = "--motion-duration-fast"
export const MOTION_DURATION_NORMAL_TOKEN = "--motion-duration-normal"
export const MOTION_DURATION_SLOW_TOKEN = "--motion-duration-slow"

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

export const getMotionDuration = (token: string, fallback: number) => {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (value.endsWith("ms")) {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? fallback : parsed
  }
  if (value.endsWith("s")) {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? fallback : parsed * 1000
  }
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? fallback : parsed
}
