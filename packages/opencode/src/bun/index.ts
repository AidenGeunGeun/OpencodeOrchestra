import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@opencode-ai/util/error"
import { readableStreamToText } from "bun"
import { createRequire } from "module"
import { Lock } from "../util/lock"

export namespace BunProc {
  const log = Log.create({ service: "bun" })
  const req = createRequire(import.meta.url)

  export async function run(cmd: string[], options?: Bun.SpawnOptions.OptionsObject<any, any, any>) {
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    const code = await result.exited
    const stdout = result.stdout
      ? typeof result.stdout === "number"
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined
    const stderr = result.stderr
      ? typeof result.stderr === "number"
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined
    log.info("done", {
      code,
      stdout,
      stderr,
    })
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}`)
    }
    return result
  }

  export const RuntimeUnavailableError = NamedError.create(
    "BunRuntimeUnavailableError",
    z.object({ command: z.string() }),
  )

  export function which(command = "bun") {
    const binary = Bun.which(command)
    if (binary) return binary
    if (command === "bun" && process.versions.bun) return process.execPath
    throw new RuntimeUnavailableError(
      { command },
      {
        cause: new Error(
          `The '${command}' runtime is not available on PATH. Packaged Electron can start normally without global Bun, but package/plugin/LSP installation features need Bun installed or a bundled runtime.`,
        ),
      },
    )
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  export async function install(pkg: string, version = "latest") {
    // Use lock to ensure only one install at a time
    using _ = await Lock.write("bun-install")

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })
    const dependencies = parsed.dependencies ?? {}
    if (!parsed.dependencies) parsed.dependencies = dependencies
    const modExists = await Filesystem.exists(mod)
    if (dependencies[pkg] === version && modExists) return mod

    const proxied = !!(
      process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.https_proxy
    )

    // Build command arguments
    const args = [
      "add",
      "--force",
      "--exact",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied ? ["--no-cache"] : []),
      "--cwd",
      Global.Path.cache,
      pkg + "@" + version,
    ]

    // Let Bun handle registry resolution:
    // - If .npmrc files exist, Bun will use them automatically
    // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
    // - No need to pass --registry flag
    log.info("installing package using Bun's default registry resolution", {
      pkg,
      version,
    })

    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })

    // Resolve actual version from installed package when using "latest"
    // This ensures subsequent starts use the cached version until explicitly updated
    let resolvedVersion = version
    if (version === "latest") {
      const installedPkgJson = Bun.file(path.join(mod, "package.json"))
      const installedPkg = await installedPkgJson.json().catch(() => null)
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
      }
    }

    parsed.dependencies[pkg] = resolvedVersion
    await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2))
    return mod
  }

  export async function installGit(specifier: string) {
    using _ = await Lock.write("bun-install")

    const pkgjsonPath = path.join(Global.Path.cache, "package.json")
    const pkgjson = Bun.file(pkgjsonPath)
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })
    const dependencies: Record<string, string> = parsed.dependencies ?? {}
    const previousDependencies = { ...dependencies }
    if (!parsed.dependencies) parsed.dependencies = dependencies

    for (const [name, spec] of Object.entries(dependencies)) {
      if (spec !== specifier) continue
      const modPath = path.join(Global.Path.cache, "node_modules", name)
      if (await Filesystem.exists(modPath)) {
        log.info("git package already installed", { specifier, name })
        return modPath
      }
    }

    const proxied = !!(
      process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.https_proxy
    )

    const args = ["add", "--force", ...(proxied ? ["--no-cache"] : []), "--cwd", Global.Path.cache, specifier]

    log.info("installing git package", { specifier })

    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      throw new InstallFailedError(
        { pkg: specifier, version: "git" },
        {
          cause: e,
        },
      )
    })

    const updatedParsed = await Bun.file(pkgjsonPath).json()
    const updatedDependencies: Record<string, string> = updatedParsed.dependencies ?? {}

    for (const [name, spec] of Object.entries(updatedDependencies)) {
      if (spec === specifier) {
        return path.join(Global.Path.cache, "node_modules", name)
      }
    }

    for (const [name, spec] of Object.entries(updatedDependencies)) {
      if (spec.startsWith(specifier)) {
        return path.join(Global.Path.cache, "node_modules", name)
      }
    }

    for (const name of Object.keys(updatedDependencies)) {
      if (!(name in previousDependencies)) {
        return path.join(Global.Path.cache, "node_modules", name)
      }
    }

    throw new InstallFailedError(
      { pkg: specifier, version: "git" },
      {
        cause: new Error(`Could not determine installed package name for ${specifier}`),
      },
    )
  }
}
