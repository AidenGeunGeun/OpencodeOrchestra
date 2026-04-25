import { spawn as create } from "bun-pty"
import type { Options, Proc } from "./pty"

export type { Disposable, Exit, Options, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Options): Proc {
  const pty = create(file, args, opts)
  return {
    pid: pty.pid,
    onData(listener) {
      return pty.onData(listener)
    },
    onExit(listener) {
      return pty.onExit(listener)
    },
    write(data) {
      pty.write(data)
    },
    resize(cols, rows) {
      pty.resize(cols, rows)
    },
    kill(signal) {
      pty.kill(signal)
    },
  }
}
