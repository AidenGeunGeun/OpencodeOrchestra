import { spawn as nodeSpawn } from "node:child_process"
import { accessSync, constants, createReadStream, readdirSync, realpathSync, statSync } from "node:fs"
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { delimiter, dirname, isAbsolute, join, relative } from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath, pathToFileURL } from "node:url"
import { minimatch } from "minimatch"

type SpawnOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  stdout?: "pipe" | "inherit" | "ignore"
  stderr?: "pipe" | "inherit" | "ignore"
  stdin?: "pipe" | "inherit" | "ignore"
}

type SpawnConfig = SpawnOptions & { cmd: string[] }

class NodeFile {
  constructor(public name: string) {}

  get type() {
    if (this.name.endsWith(".html")) return "text/html; charset=utf-8"
    if (this.name.endsWith(".json")) return "application/json"
    if (this.name.endsWith(".js")) return "text/javascript"
    if (this.name.endsWith(".css")) return "text/css"
    if (this.name.endsWith(".svg")) return "image/svg+xml"
    if (this.name.endsWith(".png")) return "image/png"
    if (this.name.endsWith(".jpg") || this.name.endsWith(".jpeg")) return "image/jpeg"
    if (this.name.endsWith(".webp")) return "image/webp"
    return ""
  }

  async exists() {
    return access(this.name)
      .then(() => true)
      .catch(() => false)
  }

  stat() {
    return stat(this.name)
  }

  text() {
    return readFile(this.name, "utf8")
  }

  async json() {
    return JSON.parse(await this.text())
  }

  async arrayBuffer() {
    const buffer = await readFile(this.name)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }

  stream() {
    return Readable.toWeb(createReadStream(this.name))
  }

  async write(data: string | ArrayBuffer | Uint8Array | Blob | Response) {
    await write(this.name, data)
  }
}

type GlobScanOptions = {
  cwd?: string
  absolute?: boolean
  onlyFiles?: boolean
  followSymlinks?: boolean
  dot?: boolean
}

class NodeGlob {
  constructor(private pattern: string) {}

  async *scan(options: GlobScanOptions = {}) {
    const cwd = options.cwd ?? process.cwd()
    const dot = options.dot ?? false
    const seen = new Set<string>()
    async function* walk(dir: string): AsyncGenerator<string> {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!dot && entry.name.startsWith(".")) continue
        const full = join(dir, entry.name)
        if (entry.isSymbolicLink() && options.followSymlinks) {
          const info = await stat(full).catch(() => undefined)
          if (!info) continue
          if (info.isDirectory()) {
            const resolved = await realpath(full).catch(() => full)
            if (seen.has(resolved)) continue
            seen.add(resolved)
            yield* walk(full)
            continue
          }
          if (options.onlyFiles === false || info.isFile()) yield full
          continue
        }
        if (entry.isDirectory()) {
          if (options.followSymlinks) {
            const resolved = await realpath(full).catch(() => full)
            if (seen.has(resolved)) continue
            seen.add(resolved)
          }
          yield* walk(full)
          continue
        }
        if (options.onlyFiles === false || entry.isFile()) yield full
      }
    }
    for await (const file of walk(cwd)) {
      const rel = relative(cwd, file).replaceAll("\\", "/")
      if (minimatch(rel, this.pattern, { dot })) yield options.absolute ? file : rel
    }
  }

  *scanSync(options: GlobScanOptions = {}) {
    const cwd = options.cwd ?? process.cwd()
    const dot = options.dot ?? false
    const seen = new Set<string>()
    function* walk(dir: string): Generator<string> {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (!dot && entry.name.startsWith(".")) continue
        const full = join(dir, entry.name)
        if (entry.isSymbolicLink() && options.followSymlinks) {
          let info
          try {
            info = statSync(full)
          } catch {
            continue
          }
          if (info.isDirectory()) {
            const resolved = (() => {
              try {
                return realpathSync(full)
              } catch {
                return full
              }
            })()
            if (seen.has(resolved)) continue
            seen.add(resolved)
            yield* walk(full)
            continue
          }
          if (options.onlyFiles === false || info.isFile()) yield full
          continue
        }
        if (entry.isDirectory()) {
          if (options.followSymlinks) {
            const resolved = (() => {
              try {
                return realpathSync(full)
              } catch {
                return full
              }
            })()
            if (seen.has(resolved)) continue
            seen.add(resolved)
          }
          yield* walk(full)
          continue
        }
        if (options.onlyFiles === false || entry.isFile()) yield full
      }
    }
    for (const file of walk(cwd)) {
      const rel = relative(cwd, file).replaceAll("\\", "/")
      if (minimatch(rel, this.pattern, { dot })) yield options.absolute ? file : rel
    }
  }

  match(input: string) {
    const candidate = isAbsolute(input) ? input : input
    return minimatch(candidate.replaceAll("\\", "/"), this.pattern, { dot: true })
  }
}

class ShellResult {
  stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  exitCode = 0

  constructor(stdout: Buffer<ArrayBufferLike>, stderr: Buffer<ArrayBufferLike>, exitCode: number) {
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }

  text() {
    return Promise.resolve(this.stdout.toString())
  }

  arrayBuffer() {
    return Promise.resolve(
      this.stdout.buffer.slice(this.stdout.byteOffset, this.stdout.byteOffset + this.stdout.byteLength) as ArrayBuffer,
    )
  }
}

class ShellPromise implements PromiseLike<ShellResult> {
  private cwdValue = process.cwd()
  private envValue: NodeJS.ProcessEnv = process.env
  private shouldThrow = true

  constructor(private command: string) {}

  cwd(value: string) {
    this.cwdValue = value
    return this
  }

  env(value: Record<string, string | undefined>) {
    this.envValue = { ...process.env, ...value }
    return this
  }

  quiet() {
    return this
  }

  nothrow() {
    this.shouldThrow = false
    return this
  }

  throws(value: boolean) {
    this.shouldThrow = value
    return this
  }

  async run() {
    const result = await new Promise<ShellResult>((resolve, reject) => {
      const child = nodeSpawn(this.command, {
        cwd: this.cwdValue,
        env: this.envValue,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
      child.on("error", reject)
      child.on("close", (code) => resolve(new ShellResult(Buffer.concat(stdout), Buffer.concat(stderr), code ?? 0)))
    })
    if (this.shouldThrow && result.exitCode !== 0) throw new Error(`Command failed with exit code ${result.exitCode}`)
    return result
  }

  then<TResult1 = ShellResult, TResult2 = never>(
    onfulfilled?: ((value: ShellResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.run().then(onfulfilled, onrejected)
  }

  text() {
    return this.run().then((result) => result.stdout.toString())
  }

  arrayBuffer() {
    return this.run().then((result) => result.arrayBuffer())
  }
}

function escape(value: unknown): string {
  if (typeof value === "object" && value && "raw" in value) return String((value as { raw: unknown }).raw)
  if (Array.isArray(value)) return value.map(escape).join(" ")
  const text = String(value)
  return `'${text.replaceAll("'", "'\\''")}'`
}

export function $(strings: TemplateStringsArray, ...values: unknown[]) {
  const command = strings.reduce(
    (acc, item, index) => acc + item + (index < values.length ? escape(values[index]) : ""),
    "",
  )
  return new ShellPromise(command)
}

export async function readableStreamToText(stream: ReadableStream | NodeJS.ReadableStream) {
  if (stream instanceof ReadableStream) return await new Response(stream).text()
  const chunks: Buffer[] = []
  for await (const chunk of stream as NodeJS.ReadableStream)
    chunks.push(Buffer.from(chunk as Parameters<typeof Buffer.from>[0]))
  return Buffer.concat(chunks).toString()
}

export { fileURLToPath, pathToFileURL }

function file(input: string | URL | { name?: string }) {
  return new NodeFile(
    typeof input === "string" ? input : input instanceof URL ? fileURLToPath(input) : (input.name ?? ""),
  )
}

async function toBuffer(data: string | ArrayBuffer | Uint8Array | Blob | Response) {
  if (typeof data === "string") return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (data instanceof Blob) return Buffer.from(await data.arrayBuffer())
  return Buffer.from(await data.arrayBuffer())
}

async function write(
  input: string | URL | { name?: string },
  data: string | ArrayBuffer | Uint8Array | Blob | Response,
) {
  const target = typeof input === "string" ? input : input instanceof URL ? fileURLToPath(input) : (input.name ?? "")
  await mkdir(dirname(target), { recursive: true })
  const body = await toBuffer(data)
  await writeFile(target, body)
}

function spawn(command: string[] | SpawnConfig, options: SpawnOptions = {}) {
  const cmd = Array.isArray(command) ? command : command.cmd
  const opts = Array.isArray(command) ? options : command
  const child = nodeSpawn(cmd[0]!, cmd.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "pipe", opts.stderr ?? "pipe"],
  })
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 0))
  })
  return {
    stdin: child.stdin ?? undefined,
    stdout: child.stdout ? Readable.toWeb(child.stdout) : undefined,
    stderr: child.stderr ? Readable.toWeb(child.stderr) : undefined,
    exited,
    get exitCode() {
      return child.exitCode
    },
    kill: () => child.kill(),
  }
}

async function resolve(specifier: string, from = process.cwd()) {
  const req = createRequire(join(from, "noop.js"))
  return req.resolve(specifier)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const stdin = {
  async text() {
    return await readableStreamToText(process.stdin)
  },
}

function xxHash32(input: string | ArrayBuffer | Uint8Array) {
  const bytes =
    typeof input === "string" ? Buffer.from(input) : input instanceof Uint8Array ? input : new Uint8Array(input)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const shim = {
  $,
  file,
  write,
  spawn,
  resolve,
  sleep,
  stdin,
  readableStreamToText,
  Glob: NodeGlob,
  env: process.env,
  hash: { xxHash32 },
}
Object.assign(shim, {
  which(command: string, options?: { PATH?: string }) {
    for (const dir of (options?.PATH ?? process.env.PATH ?? "").split(delimiter)) {
      const candidate = join(dir, command)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {}
    }
    return null
  },
})
;(globalThis as unknown as { Bun?: unknown }).Bun = shim
