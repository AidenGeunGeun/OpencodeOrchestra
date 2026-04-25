export type Disposable = {
  dispose(): void
}

export type Exit = {
  exitCode: number
  signal?: number | string
}

export type Options = {
  name: string
  cols?: number
  rows?: number
  cwd?: string
  env?: Record<string, string>
}

export type Proc = {
  pid: number
  onData(listener: (data: string) => void): Disposable
  onExit(listener: (event: Exit) => void): Disposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
