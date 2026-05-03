import { describe, expect, test } from "bun:test"
import { createStoreWriteBuffer, type PendingStoreWrite } from "./store-write-buffer"

describe("store write buffer", () => {
  test("coalesces repeated sets to the latest value", () => {
    const flushed: Array<[string, [string, PendingStoreWrite][]]> = []
    const buffer = createStoreWriteBuffer({
      debounceMs: 10_000,
      maxWaitMs: 10_000,
      write: (name, entries) => flushed.push([name, entries]),
    })

    buffer.set("opencode.global.dat", "layout", "one")
    buffer.set("opencode.global.dat", "layout", "two")
    buffer.flush("opencode.global.dat")

    expect(flushed).toEqual([
      ["opencode.global.dat", [["layout", { type: "set", value: "two" }]]],
    ])
  })

  test("returns pending set values before flush", () => {
    const buffer = createStoreWriteBuffer({
      debounceMs: 10_000,
      maxWaitMs: 10_000,
      write: () => {},
    })

    buffer.set("opencode.global.dat", "layout", "queued")

    expect(buffer.pending("opencode.global.dat", "layout")).toEqual({ found: true, value: "queued" })
    expect(buffer.pending("opencode.global.dat", "missing")).toEqual({ found: false })
  })

  test("returns pending deletes before flush", () => {
    const flushed: Array<[string, [string, PendingStoreWrite][]]> = []
    const buffer = createStoreWriteBuffer({
      debounceMs: 10_000,
      maxWaitMs: 10_000,
      write: (name, entries) => flushed.push([name, entries]),
    })

    buffer.set("opencode.global.dat", "layout", "queued")
    buffer.delete("opencode.global.dat", "layout")

    expect(buffer.pending("opencode.global.dat", "layout")).toEqual({ found: true, value: null })

    buffer.flush("opencode.global.dat")

    expect(flushed).toEqual([["opencode.global.dat", [["layout", { type: "delete" }]]]])
  })

  test("flushAll writes every queued store", () => {
    const flushed: Array<[string, [string, PendingStoreWrite][]]> = []
    const buffer = createStoreWriteBuffer({
      debounceMs: 10_000,
      maxWaitMs: 10_000,
      write: (name, entries) => flushed.push([name, entries]),
    })

    buffer.set("opencode.global.dat", "layout", "global")
    buffer.set("opencode.workspace.demo.dat", "workspace:project", "workspace")
    buffer.flushAll()

    expect(flushed).toEqual([
      ["opencode.global.dat", [["layout", { type: "set", value: "global" }]]],
      ["opencode.workspace.demo.dat", [["workspace:project", { type: "set", value: "workspace" }]]],
    ])
  })

  test("keeps queued writes when flush fails", () => {
    let fail = true
    const flushed: Array<[string, [string, PendingStoreWrite][]]> = []
    const buffer = createStoreWriteBuffer({
      debounceMs: 10_000,
      maxWaitMs: 10_000,
      write: (name, entries) => {
        if (fail) throw new Error("disk failed")
        flushed.push([name, entries])
      },
    })

    buffer.set("opencode.global.dat", "layout", "queued")

    expect(() => buffer.flush("opencode.global.dat")).toThrow("disk failed")
    expect(buffer.pending("opencode.global.dat", "layout")).toEqual({ found: true, value: "queued" })

    fail = false
    buffer.flush("opencode.global.dat")

    expect(flushed).toEqual([["opencode.global.dat", [["layout", { type: "set", value: "queued" }]]]])
  })
})
