/**
 * OpenCodeOrchestra: Depth-Aware Client Wrapper for DCP Integration
 * 
 * This module wraps the SDK client to provide depth-aware parentID responses.
 * DCP (Dynamic Context Pruning) uses parentID to determine if a session is a "subagent".
 * 
 * Original DCP behavior:
 *   - parentID exists → skip pruning (considered subagent)
 *   - parentID undefined → apply pruning
 * 
 * OcO depth-aware behavior:
 *   - depth 0 (PM) → parentID hidden → DCP applies pruning
 *   - depth 1 (Orchestrator) → parentID hidden → DCP applies pruning  
 *   - depth 2+ (Subagent) → parentID shown → DCP skips pruning
 * 
 * This approach allows DCP to remain completely unmodified while OcO controls
 * the pruning behavior through the client wrapper.
 */

import type { createOpencodeClient } from "@opencodeorchestra/sdk"
import { calculateDepth, shouldApplyPruning } from "../session/depth"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.client-wrapper" })

type OpencodeClient = ReturnType<typeof createOpencodeClient>

/**
 * Wraps the SDK client to provide depth-aware parentID responses for DCP.
 * 
 * When a plugin (like DCP) calls client.session.get(), this wrapper:
 * 1. Calls the original session.get() to get the real response
 * 2. Calculates the session depth using calculateDepth()
 * 3. If depth <= 1 (PM or Orchestrator), hides parentID from the response
 * 4. If depth >= 2 (Subagent), returns the original response with parentID
 * 
 * @param client - The original SDK client from createOpencodeClient()
 * @returns A wrapped client with depth-aware session.get() behavior
 */
export function wrapClientForDepthAwareness(client: OpencodeClient): OpencodeClient {
  // Create a proxy for the session object
  const wrappedSession = new Proxy(client.session, {
    get(target, prop, receiver) {
      if (prop === "get") {
        // Wrap the session.get() method
        return async function wrappedGet(
          ...args: Parameters<typeof target.get>
        ) {
          // Call the original session.get()
          const result = await target.get(...args)
          
          // Extract sessionID from the request path
          const sessionID = args[0]?.path?.id
          if (!sessionID) {
            return result
          }
          
          // Check if the result has data with parentID
          if (!result.data?.parentID) {
            // No parentID, nothing to hide
            return result
          }
          
          try {
            // Calculate depth for this session
            const depth = await calculateDepth(sessionID)
            
            if (shouldApplyPruning(depth)) {
              // depth <= 1: Hide parentID so DCP applies pruning
              log.info("hiding parentID for DCP (depth-aware)", {
                sessionID,
                depth,
                action: "apply_pruning",
              })
              
              return {
                ...result,
                data: {
                  ...result.data,
                  parentID: undefined,
                },
              }
            } else {
              // depth >= 2: Keep parentID so DCP skips pruning
              log.info("keeping parentID for DCP (depth-aware)", {
                sessionID,
                depth,
                action: "skip_pruning",
              })
              return result
            }
          } catch (error) {
            // On error, return original result (fail-safe)
            log.error("depth calculation failed, returning original", {
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
            return result
          }
        }
      }
      
      // For all other properties, return the original
      return Reflect.get(target, prop, receiver)
    },
  })

  // Create a proxy for the entire client to replace the session property
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "session") {
        return wrappedSession
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
