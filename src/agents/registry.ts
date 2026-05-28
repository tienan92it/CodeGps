/**
 * Central registry of every agent.
 *
 * Empty in M0; populated incrementally as each milestone adds an agent.
 * Keeping a single source of truth means `agents list`, `agents eval`, and
 * the orchestrator share the same set.
 */

import type { Agent } from './runtime.js';

// Populated by M3+ milestones. Imported lazily to keep M0 buildable
// without all agent files existing yet.
export const ALL_AGENTS: Agent<any, any>[] = [];

export function registerAgent<I, O>(a: Agent<I, O>): void {
  if (ALL_AGENTS.some((x) => x.name === a.name)) return;
  ALL_AGENTS.push(a as Agent<any, any>);
}

export function getAgent(name: string): Agent<any, any> | undefined {
  return ALL_AGENTS.find((a) => a.name === name);
}
