import type { AgentId, RawTurn, SessionRef } from '../types.js';

export interface SessionAdapter {
  agent: AgentId;
  /** Discover sessions associated with the given project root. */
  discover(projectRoot: string): AsyncIterable<SessionRef>;
  /** Read raw turns from a session, starting at the given byte offset. */
  read(
    ref: SessionRef, fromOffset: number,
  ): AsyncIterable<{ turn: RawTurn; offsetAfter: number }>;
}
