import type { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"

export type ListenOptions = {
  port: number
  hostname: string
}

export type Listener = {
  port: number
  stop(close?: boolean): void | Promise<void>
}

export interface Runtime {
  upgradeWebSocket: UpgradeWebSocket
  listen(opts: ListenOptions): Listener | Promise<Listener>
}

export interface Adapter {
  create(app: Hono): Runtime
}
