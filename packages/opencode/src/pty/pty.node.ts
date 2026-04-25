// @ts-expect-error The package ships declarations outside its exports map.
import * as pty from "@lydell/node-pty"
import type { Options, Proc } from "./pty"

export type { Disposable, Exit, Options, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Options): Proc {
  const proc = pty.spawn(file, args, opts)
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      proc.kill(signal)
    },
  }
}
