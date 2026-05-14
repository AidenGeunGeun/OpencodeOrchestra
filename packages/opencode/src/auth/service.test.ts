import { beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"

const testHome = path.join(process.cwd(), "tmp", "auth-service-test")

const { AuthService, __setTestFile } = await import("./service")

beforeEach(async () => {
  await fs.mkdir(testHome, { recursive: true })
  const authFile = path.join(testHome, "auth.json")
  __setTestFile(authFile)
  try {
    await fs.unlink(authFile)
  } catch {
    // ignore
  }
})

async function getAuthService() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AuthService
      return service
    }).pipe(Effect.provide(AuthService.layer)),
  )
}

describe("AuthService.all", () => {
  test("still drops unparseable entries from the parsed map", async () => {
    const authFile = path.join(testHome, "auth.json")

    const raw = {
      anthropic: { type: "api", key: "k1" },
      "future-provider": { type: "unknown", magicToken: 12345 },
    }

    await fs.writeFile(authFile, JSON.stringify(raw, null, 2))

    const auth = await getAuthService()
    const all = await Effect.runPromise(auth.all())

    expect(all.anthropic).toEqual({ type: "api", key: "k1" })
    expect(all["future-provider"]).toBeUndefined()
  })
})

describe("AuthService.remove", () => {
  test("preserves unparseable entries while removing the targeted provider", async () => {
    const authFile = path.join(testHome, "auth.json")

    const raw = {
      anthropic: {
        type: "api",
        key: "sk-ant-api-test",
      },
      "future-provider": {
        type: "unknown",
        magicToken: 12345,
      },
    }

    await fs.writeFile(authFile, JSON.stringify(raw, null, 2))

    const auth = await getAuthService()
    await Effect.runPromise(auth.remove("anthropic"))

    const after = await fs.readFile(authFile, "utf8").then((text) => JSON.parse(text))

    expect(after.anthropic).toBeUndefined()
    expect(after["future-provider"]).toEqual({
      type: "unknown",
      magicToken: 12345,
    })
  })

  test("removes normalized and trailing-slash variants", async () => {
    const authFile = path.join(testHome, "auth.json")

    const raw = {
      "custom/provider": { type: "api", key: "k1" },
      "custom/provider/": { type: "api", key: "k2" },
      other: { type: "api", key: "k3" },
    }

    await fs.writeFile(authFile, JSON.stringify(raw, null, 2))

    const auth = await getAuthService()
    await Effect.runPromise(auth.remove("custom/provider/"))

    const after = await fs.readFile(authFile, "utf8").then((text) => JSON.parse(text))

    expect(after["custom/provider"]).toBeUndefined()
    expect(after["custom/provider/"]).toBeUndefined()
    expect(after.other).toEqual({ type: "api", key: "k3" })
  })
})
