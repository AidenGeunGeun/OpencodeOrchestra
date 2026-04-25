declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      wsl?: boolean
      deepLinks?: string[]
    }
  }
}

export {}
