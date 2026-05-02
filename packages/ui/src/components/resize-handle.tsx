import { splitProps, type JSX } from "solid-js"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  collapseThreshold?: number
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onCollapse",
    "collapseThreshold",
    "class",
    "classList",
  ])

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      e.stopPropagation()
      return
    }
    e.preventDefault()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const startSize = local.size
    let current = startSize
    let ended = false
    const pointerID = e.pointerId
    const target = e.currentTarget as HTMLDivElement
    const cursor = local.direction === "horizontal" ? "col-resize" : "row-resize"
    const previousUserSelect = document.body.style.userSelect
    const previousOverflow = document.body.style.overflow
    const previousCursor = document.body.style.cursor
    const overlay = document.createElement("div")

    overlay.setAttribute("data-component", "resize-capture-overlay")
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor,
      background: "transparent",
      touchAction: "none",
      userSelect: "none",
    })

    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    document.body.style.cursor = cursor
    document.body.appendChild(overlay)

    try {
      target.setPointerCapture(pointerID)
    } catch {
      // Some embedded desktop surfaces do not allow pointer capture here.
    }

    const resize = (clientX: number, clientY: number) => {
      const pos = local.direction === "horizontal" ? clientX : clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : edge === "start"
            ? start - pos
            : pos - start
      current = startSize + delta
      const clamped = Math.min(local.max, Math.max(local.min, current))
      local.onResize(clamped)
    }

    const end = () => {
      if (ended) return
      ended = true
      document.body.style.userSelect = previousUserSelect
      document.body.style.overflow = previousOverflow
      document.body.style.cursor = previousCursor
      overlay.remove()
      window.removeEventListener("pointermove", onPointerMove, true)
      window.removeEventListener("pointerup", onPointerEnd, true)
      window.removeEventListener("pointercancel", onPointerEnd, true)
      window.removeEventListener("mouseup", onMouseUpFallback, true)
      window.removeEventListener("blur", end, true)
      document.removeEventListener("visibilitychange", onVisibilityChange, true)
      target.removeEventListener("lostpointercapture", onPointerEnd)

      try {
        if (target.hasPointerCapture(pointerID)) target.releasePointerCapture(pointerID)
      } catch {
        // Pointer capture may already have been released by the browser.
      }

      const threshold = local.collapseThreshold ?? 0
      if (local.onCollapse && threshold > 0 && current < threshold) {
        local.onCollapse()
      }
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      if (moveEvent.buttons === 0) {
        end()
        return
      }
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      if (Number.isFinite(pos)) resize(moveEvent.clientX, moveEvent.clientY)
    }

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerID) return
      end()
    }

    const onMouseUpFallback = () => end()

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") end()
    }

    window.addEventListener("pointermove", onPointerMove, true)
    window.addEventListener("pointerup", onPointerEnd, true)
    window.addEventListener("pointercancel", onPointerEnd, true)
    window.addEventListener("mouseup", onMouseUpFallback, true)
    window.addEventListener("blur", end, true)
    document.addEventListener("visibilitychange", onVisibilityChange, true)
    target.addEventListener("lostpointercapture", onPointerEnd)
  }

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      onPointerDown={handlePointerDown}
    />
  )
}
