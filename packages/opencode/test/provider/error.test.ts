import { describe, expect, test } from "bun:test"
import type { APICallError } from "ai"
import { ProviderError } from "../../src/provider/error"

function apiError(input: Partial<APICallError> & { message: string }): APICallError {
  return {
    isRetryable: false,
    ...input,
  } as APICallError
}

describe("provider.error", () => {
  test("treats HTTP 413 as context overflow", () => {
    const result = ProviderError.parseAPICallError({
      providerID: "openai",
      error: apiError({
        message: "Payload Too Large",
        statusCode: 413,
      }),
    })

    expect(result.type).toBe("context_overflow")
  })

  test("does not dump raw HTML gateway pages to users", () => {
    const result = ProviderError.parseAPICallError({
      providerID: "openai",
      error: apiError({
        message: "Forbidden",
        statusCode: 403,
        responseBody: "<!DOCTYPE html><html><body>blocked</body></html>",
      }),
    })

    expect(result.type).toBe("api_error")
    expect(result.message).toContain("gateway or proxy")
    expect(result.message).not.toContain("<!DOCTYPE html>")
  })

  test("does not dump raw HTML when provider message is empty", () => {
    const result = ProviderError.parseAPICallError({
      providerID: "openai",
      error: apiError({
        message: "",
        statusCode: 401,
        responseBody: "<!DOCTYPE html><html><body>expired</body></html>",
      }),
    })

    expect(result.type).toBe("api_error")
    expect(result.message).toContain("authentication token")
    expect(result.message).not.toContain("<html>")
  })
})
