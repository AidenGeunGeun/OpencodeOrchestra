import { existsSync } from "fs"
import { EOL } from "os"
import path from "path"
import { Global } from "../global"
import { Database } from "./db"
import { JsonMigration } from "./json-migration"

export namespace JsonToSqlite {
  export type Progress = {
    current: number
    total: number
    label: string
  }

  export type Options = {
    onProgress?: (event: Progress) => void
    writeTerminalProgress?: boolean
  }

  export function needed() {
    const marker = path.join(Global.Path.data, "oco.db")
    const storageDir = path.join(Global.Path.data, "storage")
    return !existsSync(marker) && existsSync(storageDir)
  }

  export async function run(options: Options = {}) {
    if (!needed()) return false

    const terminal = options.writeTerminalProgress === true
    const tty = terminal && process.stderr.isTTY
    process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
    const width = 36
    const orange = "\x1b[38;5;214m"
    const muted = "\x1b[0;2m"
    const reset = "\x1b[0m"
    let last = -1
    if (tty) process.stderr.write("\x1b[?25l")
    try {
      await JsonMigration.run(Database.Client(), {
        progress: (event) => {
          options.onProgress?.(event)
          const percent = Math.floor((event.current / event.total) * 100)
          if (percent === last && event.current !== event.total) return
          last = percent
          if (tty) {
            const fill = Math.round((percent / 100) * width)
            const bar = `${"#".repeat(fill)}${".".repeat(width - fill)}`
            process.stderr.write(
              `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
            )
            if (event.current === event.total) process.stderr.write("\n")
            return
          }
          process.stderr.write(`sqlite-migration:${percent}${EOL}`)
        },
      })
    } finally {
      if (tty) process.stderr.write("\x1b[?25h")
      else process.stderr.write(`sqlite-migration:done${EOL}`)
    }
    process.stderr.write("Database migration complete." + EOL)
    return true
  }
}
