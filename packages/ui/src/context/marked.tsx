import { marked } from "marked"
import markedKatex from "marked-katex-extension"
import markedShiki from "marked-shiki"
import katex from "katex"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { getSharedHighlighter, registerCustomTheme, ThemeRegistrationResolved } from "@pierre/diffs"

registerCustomTheme("OpenCode", () => {
  return Promise.resolve({
    name: "OpenCode",
    colors: {
      "editor.background": "var(--color-background-stronger)",
      "editor.foreground": "var(--text-base)",
      "gitDecoration.addedResourceForeground": "var(--syntax-diff-add)",
      "gitDecoration.deletedResourceForeground": "var(--syntax-diff-delete)",
      // "gitDecoration.conflictingResourceForeground": "#ffca00",
      // "gitDecoration.modifiedResourceForeground": "#1a76d4",
      // "gitDecoration.untrackedResourceForeground": "#00cab1",
      // "gitDecoration.ignoredResourceForeground": "#84848A",
      // "terminal.titleForeground": "#adadb1",
      // "terminal.titleInactiveForeground": "#84848A",
      // "terminal.background": "#141415",
      // "terminal.foreground": "#adadb1",
      // "terminal.ansiBlack": "#141415",
      // "terminal.ansiRed": "#ff2e3f",
      // "terminal.ansiGreen": "#0dbe4e",
      // "terminal.ansiYellow": "#ffca00",
      // "terminal.ansiBlue": "#008cff",
      // "terminal.ansiMagenta": "#c635e4",
      // "terminal.ansiCyan": "#08c0ef",
      // "terminal.ansiWhite": "#c6c6c8",
      // "terminal.ansiBrightBlack": "#141415",
      // "terminal.ansiBrightRed": "#ff2e3f",
      // "terminal.ansiBrightGreen": "#0dbe4e",
      // "terminal.ansiBrightYellow": "#ffca00",
      // "terminal.ansiBrightBlue": "#008cff",
      // "terminal.ansiBrightMagenta": "#c635e4",
      // "terminal.ansiBrightCyan": "#08c0ef",
      // "terminal.ansiBrightWhite": "#c6c6c8",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: {
          foreground: "var(--syntax-comment)",
        },
      },
      {
        scope: ["entity.other.attribute-name"],
        settings: {
          foreground: "var(--syntax-property)", // maybe attribute
        },
      },
      {
        scope: ["constant", "entity.name.constant", "variable.other.constant", "variable.language", "entity"],
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: ["entity.name", "meta.export.default", "meta.definition.variable"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: ["meta.object.member"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "variable.parameter.function",
          "meta.jsx.children",
          "meta.block",
          "meta.tag.attributes",
          "entity.name.constant",
          "meta.embedded.expression",
          "meta.template.expression",
          "string.other.begin.yaml",
          "string.other.end.yaml",
        ],
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["entity.name.function", "support.type.primitive"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.class.component"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: [
          "keyword.operator",
          "storage.type.function.arrow",
          "punctuation.separator.key-value.css",
          "entity.name.tag.yaml",
          "punctuation.separator.key-value.mapping.yaml",
        ],
        settings: {
          foreground: "var(--syntax-operator)",
        },
      },
      {
        scope: ["storage", "storage.type"],
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: ["storage.modifier.package", "storage.modifier.import", "storage.type.java"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "string",
          "punctuation.definition.string",
          "string punctuation.section.embedded source",
          "entity.name.tag",
        ],
        settings: {
          foreground: "var(--syntax-string)",
        },
      },
      {
        scope: "support",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.type.object.module", "variable.other.object", "support.type.property-name.css"],
        settings: {
          foreground: "var(--syntax-object)",
        },
      },
      {
        scope: "meta.property-name",
        settings: {
          foreground: "var(--syntax-property)",
        },
      },
      {
        scope: "variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "variable.other",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: [
          "invalid.broken",
          "invalid.illegal",
          "invalid.unimplemented",
          "invalid.deprecated",
          "message.error",
          "markup.deleted",
          "meta.diff.header.from-file",
          "punctuation.definition.deleted",
          "brackethighlighter.unmatched",
          "token.error-token",
        ],
        settings: {
          foreground: "var(--syntax-critical)",
        },
      },
      {
        scope: "carriage-return",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: "string source",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "string variable",
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: [
          "source.regexp",
          "string.regexp",
          "string.regexp.character-class",
          "string.regexp constant.character.escape",
          "string.regexp source.ruby.embedded",
          "string.regexp string.regexp.arbitrary-repitition",
          "string.regexp constant.character.escape",
        ],
        settings: {
          foreground: "var(--syntax-regexp)",
        },
      },
      {
        scope: "support.constant",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: "support.variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "meta.module-reference",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["markup.heading", "markup.heading entity.name"],
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.quote",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.italic",
        settings: {
          fontStyle: "italic",
          // foreground: "",
        },
      },
      {
        scope: "markup.bold",
        settings: {
          fontStyle: "bold",
          foreground: "var(--text-strong)",
        },
      },
      {
        scope: [
          "markup.raw",
          "markup.inserted",
          "meta.diff.header.to-file",
          "punctuation.definition.inserted",
          "markup.changed",
          "punctuation.definition.changed",
          "markup.ignored",
          "markup.untracked",
        ],
        settings: {
          foreground: "var(--text-base)",
        },
      },
      {
        scope: "meta.diff.range",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.diff.header",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.separator",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.output",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.export.default",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: [
          "brackethighlighter.tag",
          "brackethighlighter.curly",
          "brackethighlighter.round",
          "brackethighlighter.square",
          "brackethighlighter.angle",
          "brackethighlighter.quote",
        ],
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: ["constant.other.reference.link", "string.other.link"],
        settings: {
          fontStyle: "underline",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "var(--syntax-warning)",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
    ],
    semanticTokenColors: {
      comment: "var(--syntax-comment)",
      string: "var(--syntax-string)",
      number: "var(--syntax-constant)",
      regexp: "var(--syntax-regexp)",
      keyword: "var(--syntax-keyword)",
      variable: "var(--syntax-variable)",
      parameter: "var(--syntax-variable)",
      property: "var(--syntax-property)",
      function: "var(--syntax-primitive)",
      method: "var(--syntax-primitive)",
      type: "var(--syntax-type)",
      class: "var(--syntax-type)",
      namespace: "var(--syntax-type)",
      enumMember: "var(--syntax-primitive)",
      "variable.constant": "var(--syntax-constant)",
      "variable.defaultLibrary": "var(--syntax-unknown)",
    },
  } as unknown as ThemeRegistrationResolved)
})

const displayMathRegex = /\$\$([\s\S]*?)\$\$/g
const inlineMathRegex = /(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g
const mathSkippedAncestorSelector = "pre, code, kbd, table, thead, tbody, tfoot, tr, th, td, caption"

function renderMathInText(text: string): string {
  let result = text

  // Display math: $$...$$
  result = result.replace(displayMathRegex, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: true,
        throwOnError: false,
      })
    } catch {
      return `$$${math}$$`
    }
  })

  // Inline math: $...$
  result = result.replace(inlineMathRegex, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: false,
        throwOnError: false,
      })
    } catch {
      return `$${math}$`
    }
  })

  return result
}

function appendRenderedMath(document: Document, fragment: DocumentFragment, text: string): boolean {
  const rendered = renderMathInText(text)

  if (rendered === text) {
    fragment.append(text)
    return false
  }

  const template = document.createElement("template")
  template.innerHTML = rendered
  fragment.append(template.content)
  return true
}

function appendInlineMath(document: Document, fragment: DocumentFragment, text: string): boolean {
  let hasRenderedMath = false
  let lastIndex = 0

  for (const match of text.matchAll(new RegExp(inlineMathRegex))) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      fragment.append(text.slice(lastIndex, start))
    }

    hasRenderedMath = appendRenderedMath(document, fragment, match[0]) || hasRenderedMath
    lastIndex = start + match[0].length
  }

  if (lastIndex === 0) {
    fragment.append(text)
    return false
  }

  if (lastIndex < text.length) {
    fragment.append(text.slice(lastIndex))
  }

  return hasRenderedMath
}

function renderMathExpressions(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html")
  const { body } = document

  // Handle comrak's math_dollars output: <span data-math-style="inline|display">...</span>
  // These come from the native Rust parser when math_dollars extension is enabled.
  // The content has backslashes preserved (unlike plain markdown text nodes).
  const mathSpans = body.querySelectorAll<HTMLElement>("span[data-math-style]")
  for (const span of mathSpans) {
    const mathContent = span.textContent ?? ""
    const isDisplay = span.getAttribute("data-math-style") === "display"
    try {
      const rendered = katex.renderToString(mathContent, {
        displayMode: isDisplay,
        throwOnError: false,
      })
      const template = document.createElement("template")
      template.innerHTML = rendered
      span.replaceWith(template.content)
    } catch {
      // leave span as-is on error
    }
  }

  // Also handle any remaining $...$ / $$...$$ in plain text nodes
  // (fallback for non-native parser paths or mixed content)
  const treeWalker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  let currentNode = treeWalker.nextNode()
  while (currentNode) {
    if (
      currentNode instanceof Text &&
      currentNode.textContent?.includes("$") &&
      !currentNode.parentElement?.closest(mathSkippedAncestorSelector)
    ) {
      textNodes.push(currentNode)
    }

    currentNode = treeWalker.nextNode()
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent
    if (!text) continue

    const fragment = document.createDocumentFragment()
    let hasRenderedMath = false
    let lastIndex = 0

    for (const match of text.matchAll(new RegExp(displayMathRegex))) {
      const start = match.index ?? 0
      if (start > lastIndex) {
        hasRenderedMath = appendInlineMath(document, fragment, text.slice(lastIndex, start)) || hasRenderedMath
      }

      hasRenderedMath = appendRenderedMath(document, fragment, match[0]) || hasRenderedMath
      lastIndex = start + match[0].length
    }

    if (lastIndex === 0) {
      hasRenderedMath = appendInlineMath(document, fragment, text)
      if (!hasRenderedMath) continue
    } else if (lastIndex < text.length) {
      hasRenderedMath = appendInlineMath(document, fragment, text.slice(lastIndex)) || hasRenderedMath
    }

    if (!hasRenderedMath) continue
    textNode.replaceWith(fragment)
  }

  return body.innerHTML
}

// OCO: module-level lazy singleton — getSharedHighlighter is internally cached,
// but hoisting the promise here lets us skip the await microtask on every
// highlight call and reuses the same highlighter across both the native and JS
// parser code paths.
let highlighterPromise: ReturnType<typeof getSharedHighlighter> | undefined
function highlighter() {
  if (!highlighterPromise) highlighterPromise = getSharedHighlighter({ themes: ["OpenCode"], langs: [] })
  return highlighterPromise
}

// OCO: small LRU on highlighted HTML keyed by (lang, code). Streaming messages
// re-highlight the same code blocks repeatedly as new tokens arrive, and the
// same blocks reappear after navigation. The theme uses CSS variables so dark/
// light switches don't invalidate the cache. Cap is conservative — code blocks
// are large strings and we don't want to balloon memory.
const HIGHLIGHT_CACHE_MAX = 256
const highlightCache = new Map<string, string>()
async function highlight(lang: string, code: string): Promise<string> {
  const key = `${lang} ${code}`
  const cached = highlightCache.get(key)
  if (cached !== undefined) {
    // LRU touch.
    highlightCache.delete(key)
    highlightCache.set(key, cached)
    return cached
  }
  const hl = await highlighter()
  let resolvedLang = lang || "text"
  if (!(resolvedLang in bundledLanguages)) resolvedLang = "text"
  if (!hl.getLoadedLanguages().includes(resolvedLang)) {
    await hl.loadLanguage(resolvedLang as BundledLanguage)
  }
  const html = hl.codeToHtml(code, { lang: resolvedLang, theme: "OpenCode", tabindex: false })
  highlightCache.set(key, html)
  if (highlightCache.size > HIGHLIGHT_CACHE_MAX) {
    const firstKey = highlightCache.keys().next().value
    if (firstKey !== undefined) highlightCache.delete(firstKey)
  }
  return html
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g
  const matches = [...html.matchAll(codeBlockRegex)]
  if (matches.length === 0) return html

  let result = html
  for (const match of matches) {
    const [fullMatch, lang, escapedCode] = match
    const code = escapedCode
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

    const highlighted = await highlight(lang || "text", code)
    result = result.replace(fullMatch, () => highlighted)
  }

  return result
}

export type NativeMarkdownParser = (markdown: string) => Promise<string>

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: (props: { nativeParser?: NativeMarkdownParser }) => {
    const jsParser = marked.use(
      {
        renderer: {
          link({ href, title, text }) {
            const titleAttr = title ? ` title="${title}"` : ""
            return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
          },
        },
      },
      markedKatex({
        throwOnError: false,
        nonStandard: true,
      }),
      markedShiki({
        // OCO: share the module-level highlighter + LRU with the native parser path.
        async highlight(code, lang) {
          return highlight(lang || "text", code)
        },
      }),
    )

    if (props.nativeParser) {
      const nativeParser = props.nativeParser
      return {
        async parse(markdown: string): Promise<string> {
          const html = await nativeParser(markdown)
          const withMath = renderMathExpressions(html)
          return highlightCodeBlocks(withMath)
        },
      }
    }

    return jsParser
  },
})
