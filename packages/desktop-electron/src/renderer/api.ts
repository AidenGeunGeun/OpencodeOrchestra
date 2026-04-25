import type { ElectronAPI } from "../preload/types"

export const api = window.api as unknown as ElectronAPI
