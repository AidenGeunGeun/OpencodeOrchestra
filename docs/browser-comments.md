# Browser comments

OpenCodeOrchestra 2.0.0 adds a Browser tab to the right-side panel for frontend work.

Start your app's dev server, paste its local URL into the Browser tab, then click the page element you want the agent to fix. Shift-drag captures an area when the issue is about a region instead of one element. Each selection becomes a queued browser comment with a thumbnail, a note field, and a pin on the page.

When you send your chat message, OCO includes the selected screenshots, your notes, page URL, viewport, console warnings/errors, rendered styles, and source location when the dev stack exposes it. Source locations are best-effort in dev mode only: OCO can use React Fiber debug metadata or debug stacks when the app exposes them, but React 19, Next.js App Router/server components, production builds, and some Vite transform settings may omit or misalign exact file/line data. Pages without source information still send the visual comments and metadata the agent needs to work from.
