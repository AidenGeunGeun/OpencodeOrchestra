export const browserCommentMarker = "__OCO_BROWSER_COMMENT__"

export const createBrowserCommentInspectorScript = (nonce: string) => String.raw`(() => {
  const marker = ${JSON.stringify(browserCommentMarker)};
  const nonce = ${JSON.stringify(nonce)};
  const existing = window.__ocoBrowserComments;
  if (window.__ocoBrowserCommentsInstalled && existing) {
    existing.setActive?.(window.__ocoBrowserCommentsActive === true);
    return;
  }
  window.__ocoBrowserCommentsInstalled = true;
  window.__ocoBrowserCommentsActive = window.__ocoBrowserCommentsActive === true;
  const overlayAttr = "data-oco-browser-comment";
  const selectedFields = ["color", "backgroundColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "display", "position", "width", "height", "margin", "padding", "borderRadius", "zIndex", "justifyContent", "alignItems", "gridTemplateColumns", "flexDirection"];
  const send = (type, payload) => console.log(marker + JSON.stringify({ type, payload, nonce }));
  const clampText = (value, max = 240) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max) + "..." : text;
  };
  const ensureBox = (id, styles) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.setAttribute(overlayAttr, "true");
      document.documentElement.appendChild(el);
    }
    Object.assign(el.style, styles);
    return el;
  };
  const highlight = ensureBox("oco-browser-comment-highlight", {
    position: "fixed", pointerEvents: "none", zIndex: "2147483646", border: "2px solid #58a6ff", boxShadow: "0 0 0 2px rgba(88,166,255,.22)", borderRadius: "4px", display: "none"
  });
  const area = ensureBox("oco-browser-comment-area", {
    position: "fixed", pointerEvents: "none", zIndex: "2147483646", border: "2px dashed #f97316", background: "rgba(249,115,22,.16)", display: "none"
  });
  const pinLayer = ensureBox("oco-browser-comment-pins", { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
  const isOverlay = (el) => !!el?.closest?.("[" + overlayAttr + "]");
  const rectData = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  const pagePoint = (point) => ({ x: point.x + window.scrollX, y: point.y + window.scrollY, coordinateSpace: "page" });
  const styleData = (el) => {
    const computed = getComputedStyle(el);
    const out = {};
    for (const key of selectedFields) out[key] = computed[key];
    return out;
  };
  const sourceFromFiber = (fiber) => {
    let current = fiber;
    for (let depth = 0; depth < 24 && current; depth++) {
      const source = current._debugSource || current._debugOwner?._debugSource || current.elementType?._debugSource;
      if (source && typeof source.fileName === "string") {
        return { fileName: source.fileName, lineNumber: Number(source.lineNumber) || undefined, columnNumber: Number(source.columnNumber) || undefined, framework: source.fileName.includes("/_next/") || source.fileName.includes("next/") ? "next-react" : "react-dev" };
      }
      const stack = current._debugStack || current._debugOwner?._debugStack;
      const text = stack instanceof Error ? stack.stack : typeof stack === "string" ? stack : undefined;
      const match = text?.match(/(?:\(|\s)([^\s()]+\.(?:tsx|ts|jsx|js|vue|svelte|astro)(?:\?[^:)]*)?):(\d+):(\d+)(?:\)|\s|$)/);
      if (match) return { fileName: match[1], lineNumber: Number(match[2]) || undefined, columnNumber: Number(match[3]) || undefined, framework: match[1].includes("/_next/") || match[1].includes("webpack-internal://") ? "next-react" : "react-dev" };
      current = current.return;
    }
  };
  const sourceData = (el) => {
    const direct = el.__source || el.dataset?.source || el.dataset?.loc;
    if (direct && typeof direct === "object" && typeof direct.fileName === "string") return direct;
    const key = Object.keys(el).find((item) => item.startsWith("__reactFiber$") || item.startsWith("__reactInternalInstance$"));
    return key ? sourceFromFiber(el[key]) : undefined;
  };
  const elementData = (el) => {
    const attrs = {};
    for (const attr of Array.from(el.attributes || [])) {
      if (["id", "class", "role", "aria-label", "href", "src", "alt", "title", "data-testid"].includes(attr.name) || attr.name.startsWith("data-")) attrs[attr.name] = clampText(attr.value, 160);
    }
    return { tagName: el.tagName, id: el.id || undefined, className: typeof el.className === "string" ? clampText(el.className, 240) : undefined, role: el.getAttribute("role") || undefined, text: clampText(el.innerText || el.textContent || ""), attributes: attrs };
  };
  const active = () => window.__ocoBrowserCommentsActive === true;
  const updatePins = () => {
    positionPins();
    for (const pin of Array.from(pinLayer.children)) pin.style.pointerEvents = active() ? "auto" : "none";
  };
  const positionPin = (el) => {
    const x = Number(el.dataset.pinX), y = Number(el.dataset.pinY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const page = el.dataset.pinCoordinateSpace === "page";
    el.style.left = (page ? x - window.scrollX : x) + "px";
    el.style.top = (page ? y - window.scrollY : y) + "px";
  };
  const positionPins = () => { for (const pin of Array.from(pinLayer.children)) positionPin(pin); };
  const setActive = (next) => {
    const enabled = next === true;
    if (window.__ocoBrowserCommentsActive === enabled) {
      document.body.style.cursor = enabled ? "crosshair" : "";
      updatePins();
      return;
    }
    window.__ocoBrowserCommentsActive = enabled;
    highlight.style.display = "none";
    area.style.display = "none";
    drag = null;
    document.documentElement.toggleAttribute("data-oco-browser-comment-active", active());
    document.body.style.cursor = active() ? "crosshair" : "";
    updatePins();
  };
  const targetAt = (event) => {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || isOverlay(el) || !(el instanceof Element)) return undefined;
    return el;
  };
  const selectElement = (event) => {
    const el = targetAt(event);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const point = { x: event.clientX, y: event.clientY };
    send("selection", { kind: "element", rect: rectData(rect), point, anchor: pagePoint(point), element: elementData(el), source: sourceData(el), styles: styleData(el) });
  };
  let drag = null;
  const drawArea = (from, to) => {
    const left = Math.min(from.x, to.x), top = Math.min(from.y, to.y);
    const width = Math.abs(to.x - from.x), height = Math.abs(to.y - from.y);
    Object.assign(area.style, { display: "block", left: left + "px", top: top + "px", width: width + "px", height: height + "px" });
    return { x: left, y: top, width, height };
  };
  document.addEventListener("mousemove", (event) => {
    if (!event.isTrusted) return;
    if (!active()) { highlight.style.display = "none"; return; }
    if (drag) { drawArea(drag.start, { x: event.clientX, y: event.clientY }); return; }
    const el = targetAt(event);
    if (!el) { highlight.style.display = "none"; return; }
    const rect = el.getBoundingClientRect();
    Object.assign(highlight.style, { display: "block", left: rect.x + "px", top: rect.y + "px", width: rect.width + "px", height: rect.height + "px" });
  }, true);
  document.addEventListener("mousedown", (event) => {
    if (!event.isTrusted) return;
    if (!active() || !event.shiftKey || event.button !== 0) return;
    drag = { start: { x: event.clientX, y: event.clientY } };
    event.preventDefault(); event.stopPropagation();
  }, true);
  document.addEventListener("mousemove", (event) => {
    if (!event.isTrusted) return;
    if (!active() || !drag) return;
    event.preventDefault(); event.stopPropagation();
  }, true);
  document.addEventListener("mouseup", (event) => {
    if (!event.isTrusted) return;
    if (!active() || !drag) return;
    const rect = drawArea(drag.start, { x: event.clientX, y: event.clientY });
    area.style.display = "none";
    drag = null;
    if (rect.width >= 8 && rect.height >= 8) { const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; send("selection", { kind: "area", rect, point, anchor: pagePoint(point) }); }
    event.preventDefault(); event.stopPropagation();
  }, true);
  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    if (!active() || event.shiftKey || drag || event.button !== 0) return;
    if (isOverlay(event.target)) return;
    selectElement(event);
    event.preventDefault(); event.stopPropagation();
  }, true);
  window.__ocoBrowserComments = {
    setActive,
    clearPins() { pinLayer.replaceChildren(); },
    addPin(pin) {
      const el = document.createElement("div");
      el.setAttribute(overlayAttr, "true");
      el.dataset.pinId = pin.id;
      el.dataset.pinX = String(pin.x);
      el.dataset.pinY = String(pin.y);
      el.dataset.pinCoordinateSpace = pin.coordinateSpace === "page" ? "page" : "viewport";
      el.textContent = String(pin.index + 1);
      Object.assign(el.style, { position: "fixed", transform: "translate(-50%, -100%)", minWidth: "22px", height: "22px", padding: "0 6px", borderRadius: "999px", background: "#f97316", color: "white", font: "600 12px/22px system-ui, sans-serif", textAlign: "center", boxShadow: "0 6px 18px rgba(0,0,0,.28)", pointerEvents: active() ? "auto" : "none", cursor: "pointer" });
      positionPin(el);
      el.addEventListener("click", (event) => { if (!event.isTrusted) return; event.preventDefault(); event.stopPropagation(); send("delete", { id: pin.id }); });
      pinLayer.appendChild(el);
    }
  };
  window.addEventListener("scroll", positionPins, true);
  window.addEventListener("resize", positionPins, true);
  setActive(window.__ocoBrowserCommentsActive);
})();`

export const browserCommentInspectorScript = createBrowserCommentInspectorScript("test-nonce")
