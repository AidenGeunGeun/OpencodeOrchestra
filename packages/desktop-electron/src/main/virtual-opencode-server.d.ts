declare module "virtual:opencode-server" {
  export const NodeBackend: {
    probePtyAdapter?(): Promise<boolean>
    listen(opts: {
      hostname: string
      port: number
      onMigrationProgress?: (event: { current: number; total: number; label: string }) => void
    }): Promise<{ stop(close?: boolean): void | Promise<void> }>
  }
}
