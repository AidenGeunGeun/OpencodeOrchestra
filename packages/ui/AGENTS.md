# AGENTS.md — packages/ui

Guide for AI coding agents working inside the `packages/ui` package.

For repo-wide conventions (style guide, naming, export patterns, error handling) see the root `AGENTS.md`.

## What This Package Is

`packages/ui` is the shared UI component library and design system for OpenCode. It provides:

- Reusable SolidJS components consumed by `packages/app`
- A CSS custom-property-based theme system with light/dark variants
- Tailwind CSS 4.x configuration that both `packages/app` and `packages/ui` import
- Icon sprite systems (file icons, provider icons, app icons)
- Fonts and audio assets

## Commands

| Task                      | Command                         |
| ------------------------- | ------------------------------- |
| **Typecheck**             | `bun run typecheck` (`tsgo --noEmit`) |
| **Tailwind token regen**  | `bun run generate:tailwind`     |

There is no separate build step for development — `packages/app` imports directly from source via workspace resolution.

## CSS Architecture

CSS is structured using `@layer` declarations in strict import order. The main entry is `src/styles/index.css`:

```
@layer theme, base, components, utilities;

theme layer:
  src/styles/colors.css     # color palette variables (--color-*)
  src/styles/theme.css      # typography, spacing, shadow, breakpoint variables

base layer:
  src/styles/base.css       # element resets, :root defaults
  katex/dist/katex.min.css  # KaTeX math rendering

components layer:
  src/components/*.css      # per-component CSS (button.css, dialog.css, etc.)

utilities layer:
  src/styles/utilities.css  # one-off utility classes
  src/styles/animations.css # keyframe animations
```

`packages/app` imports only `@opencode-ai/ui/styles/tailwind` (`src/styles/tailwind/index.css`), which layers the Tailwind engine on top of the above and maps Tailwind theme tokens to the CSS custom properties defined in `src/styles/theme.css`.

## Theme System

### CSS Custom Properties

All color and style tokens are CSS custom properties injected into `:root` by `ThemeProvider` (or the preload inline style). Key variable namespaces:

| Namespace prefix      | Category                                    |
| --------------------- | ------------------------------------------- |
| `--background-*`      | Surface and overlay backgrounds             |
| `--text-*`            | Text colors, including emphasis/muted       |
| `--border-*`          | Border colors                               |
| `--icon-*`            | Icon tint colors                            |
| `--color-*`           | Raw palette (blue, green, red, … scales)    |
| `--font-family-*`     | Font stack (`--font-family-sans`, `--font-family-mono`) |
| `--font-size-*`       | Predefined font sizes (small/base/large/x-large) |
| `--shadow-*`          | Box shadow definitions                      |
| `--radius-*`          | Border radius scale                         |

### Theme Files

Built-in themes live in `src/theme/themes/*.json` (15 themes: `oc-1`, `dracula`, `catppuccin`, `tokyonight`, `nord`, `gruvbox`, `monokai`, `ayu`, `aura`, `vesper`, `onedarkpro`, `nightowl`, `solarized`, `shadesofpurple`, `carbonfox`). Each JSON file contains `id`, `name`, `light`, and `dark` variant objects describing color token values.

### ThemeProvider

`src/theme/context.tsx` exports `ThemeProvider` and `useTheme`. On mount it:
1. Reads `localStorage` for the saved `themeId` and `colorScheme`.
2. Calls `applyThemeCss(theme, themeId, mode)` which serializes the resolved tokens to a `<style id="oc-theme">` element in `<head>`.
3. Sets `document.documentElement.dataset.theme` and `dataset.colorScheme`.
4. Responds to `prefers-color-scheme` media query changes for `"system"` color scheme mode.

`src/theme/loader.ts` provides imperative helpers (`applyTheme`, `loadThemeFromUrl`, `removeTheme`) for non-context use.

### Token Resolution

`src/theme/resolve.ts` (`resolveThemeVariant`) maps the JSON theme object to a flat `Record<string, string>` of CSS variable values. `themeToCss` serializes them to a CSS block.

## Component Patterns

Components follow a consistent pattern:

1. **Wrapper + data attributes** — use a host element with `data-component="name"` and `data-variant`, `data-size` etc. for CSS targeting (not class selectors).
2. **Kobalte primitives** — interactive elements (`Button`, `Dialog`, `Select`, etc.) are built on `@kobalte/core` for accessibility.
3. **`splitProps`** — always split component-specific props from rest props to forward cleanly.
4. **CSS in a matching `.css` file** — each component has a `component-name.css` in `src/components/` imported in `src/styles/index.css`.

Example (abridged from `button.tsx`):

```tsx
export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
    >
      {props.children}
    </Kobalte>
  )
}
```

The corresponding `button.css` uses `[data-component="button"]` selectors and references `--background-*` / `--text-*` variables for theming.

## Icon System

### File Icons

- Sprite SVG: `src/components/file-icons/sprite.svg`
- Component: `src/components/file-icon.tsx` (`FileIcon`)
- Types: `src/components/file-icons/types.ts` (`IconName`)
- `chooseIconName(path, type, expanded)` maps file/folder paths to icon names via `ICON_MAPS` lookup tables (by filename, extension, and folder name).
- Usage: `<FileIcon node={{ path: "src/app.tsx", type: "file" }} />`

### Provider Icons

- `src/components/provider-icon.tsx` (`ProviderIcon`)
- Types: `src/components/provider-icons/types.ts`

### App Icons

- `src/components/app-icon.tsx`
- Types: `src/components/app-icons/types.ts`

### Generic Icon

- `src/components/icon.tsx` (`Icon`) — sprite-based icon component; `name` prop maps to `src/components/icons/` entries.

## Exports

Key export paths (from `package.json`):

| Import path                       | Source                                    |
| --------------------------------- | ----------------------------------------- |
| `@opencode-ai/ui/*`               | `src/components/*.tsx`                    |
| `@opencode-ai/ui/theme`           | `src/theme/index.ts`                      |
| `@opencode-ai/ui/theme/context`   | `src/theme/context.tsx`                   |
| `@opencode-ai/ui/context`         | `src/context/index.ts`                    |
| `@opencode-ai/ui/context/*`       | `src/context/*.tsx`                       |
| `@opencode-ai/ui/styles`          | `src/styles/index.css`                    |
| `@opencode-ai/ui/styles/tailwind` | `src/styles/tailwind/index.css`           |
| `@opencode-ai/ui/hooks`           | `src/hooks/index.ts`                      |
| `@opencode-ai/ui/icons/file-type` | `src/components/file-icons/types.ts`      |
| `@opencode-ai/ui/fonts/*`         | `src/assets/fonts/*`                      |

## Conventions

- Use `@layer components { ... }` for all new component CSS.
- Use `@layer utilities { ... }` for reusable motion utility classes that need to override component styles during state changes.
- Reference `--background-*`, `--text-*`, `--border-*`, `--icon-*` variables instead of hardcoding color values.
- Add `data-component="component-name"` on the host element; style with attribute selectors.
- Avoid inline `style` attributes on UI package components in normal cases.
- Put new shared motion patterns in `src/styles/motion-transitions.css`; do not scatter reusable transition definitions across feature files.
- Measured-motion exceptions are acceptable only when runtime dimensions or coordinates are required, such as dynamic width/height animation that cannot be expressed safely as a static class.
- Even for measured-motion exceptions, keep duration/easing aligned with shared motion tokens from `src/styles/motion.css`.
- Do not import Tauri or any native/desktop APIs.
- Follow the root `AGENTS.md` style guide: `const` over `let`, avoid `else`, namespace exports, `kebab-case` files.
- When adding a new component: create `src/components/foo.tsx` + `src/components/foo.css`, add the CSS `@import` to `src/styles/index.css`, and add the export entry to `package.json`.
