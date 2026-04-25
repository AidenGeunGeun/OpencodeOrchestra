import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "oco"
const LEGACY_ENV_PREFIX = "OPENCODE"
const legacyApp = LEGACY_ENV_PREFIX.toLowerCase()

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

const legacyData = path.join(xdgData!, legacyApp)
const legacyCache = path.join(xdgCache!, legacyApp)
const legacyConfig = path.join(xdgConfig!, legacyApp)
const legacyState = path.join(xdgState!, legacyApp)

function env(primary: string, legacy: string) {
  return process.env[primary] ?? process.env[legacy]
}

export namespace Global {
  export const Namespace = {
    app,
    legacyApp,
    projectDir: `.${app}`,
    legacyProjectDir: `.${legacyApp}`,
    configFilenames: [`${app}.jsonc`, `${app}.json`] as const,
    legacyConfigFilenames: [`${legacyApp}.jsonc`, `${legacyApp}.json`] as const,
  }

  export const Path = {
    // Allow override via OCO_TEST_HOME or OPENCODE_TEST_HOME for test isolation
    get home() {
      return env("OCO_TEST_HOME", `${LEGACY_ENV_PREFIX}_TEST_HOME`) || os.homedir()
    },
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
    legacy: {
      data: legacyData,
      cache: legacyCache,
      config: legacyConfig,
      state: legacyState,
    },
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.cache, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await fs.readFile(path.join(Global.Path.cache, "version"), "utf8").catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await fs.writeFile(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
