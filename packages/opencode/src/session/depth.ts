/**
 * OpenCodeOrchestra: Session Depth Utilities
 * 
 * Provides depth calculation for session hierarchy:
 * - PM (depth 0): Root session, no parent
 * - Orchestrator (depth 1): PM's child
 * - Subagent (depth 2+): Orchestrator's children and beyond
 * 
 * Used for:
 * - singleShot enforcement (depth 2+ = always singleShot)
 * - DCP gating (only apply pruning to depth 0-1)
 */

import { Session } from "./index"

/**
 * Calculate the depth of a session by traversing the parentID chain.
 * 
 * @param sessionID - The session ID to calculate depth for
 * @returns The depth of the session (0 = PM, 1 = Orchestrator, 2+ = Subagent)
 * 
 * @example
 * // PM session (no parent)
 * const pmDepth = await calculateDepth(pmSessionID) // returns 0
 * 
 * // Orchestrator session (PM is parent)
 * const orchDepth = await calculateDepth(orchSessionID) // returns 1
 * 
 * // Subagent session (Orchestrator is parent)
 * const subDepth = await calculateDepth(subSessionID) // returns 2
 */
// Maximum depth to prevent infinite loops from cyclic parentID chains
const MAX_DEPTH = 100

export async function calculateDepth(sessionID: string): Promise<number> {
  let depth = 0
  let currentID: string | undefined = sessionID
  const visited = new Set<string>()
  
  while (currentID && depth < MAX_DEPTH) {
    // Cycle detection
    if (visited.has(currentID)) {
      console.warn(`[depth] Cyclic parentID chain detected at session ${currentID}`)
      break
    }
    visited.add(currentID)
    
    let session: Session.Info | undefined
    try {
      session = await Session.get(currentID)
    } catch {
      session = undefined
    }
    if (!session?.parentID) break
    currentID = session.parentID
    depth++
  }
  
  return depth
}

/**
 * Determine if pruning (DCP) should be applied to a session based on depth.
 * 
 * Rules:
 * - depth 0 (PM): Apply pruning (true)
 * - depth 1 (Orchestrator): Apply pruning (true)
 * - depth 2+ (Subagent): Skip pruning (false) - singleShot sessions don't need context management
 * 
 * @param depth - The session depth (from calculateDepth)
 * @returns true if pruning should be applied, false otherwise
 */
export function shouldApplyPruning(depth: number): boolean {
  return depth <= 1
}

/**
 * Combined helper: Check if pruning should be applied to a session.
 * Convenience function that combines calculateDepth and shouldApplyPruning.
 * 
 * @param sessionID - The session ID to check
 * @returns true if pruning should be applied, false otherwise
 */
export async function shouldApplyPruningForSession(sessionID: string): Promise<boolean> {
  const depth = await calculateDepth(sessionID)
  return shouldApplyPruning(depth)
}
