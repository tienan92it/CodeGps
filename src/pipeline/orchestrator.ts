/**
 * Pipeline orchestrator — coordinates per-window: syntax pass + agent stages.
 * Filled out across M3 (triage), M4 (dedupe), M5 (extractors), M7 (clusterer/summarizer).
 */
import type { AgentRuntime, Agent } from '../agents/runtime.js';

export async function runPendingFor(
  _root: string,
  _rt: AgentRuntime,
  _agent: Agent<any, any>,
): Promise<number> {
  return 0;
}
