/**
 * Decision Agent — extracts explicit decisions and the alternatives/rationale
 * around them. Captures the "what was chosen and why" that vanishes from chat
 * logs once a session ends.
 */
import { defineExtractor } from './extractors-common.js';
import { registerAgent } from './registry.js';

export const DECISION_AGENT = defineExtractor({
  name: 'decision',
  allowedKinds: ['decision', 'constraint', 'pattern'],
  systemPrompt: `You extract DECISIONS from a conversation between a developer and an AI agent.

A decision is a chosen course of action — usually with alternatives considered and
rationale given. Examples: choosing Redis over in-memory caching, picking JWT over
sessions, deciding to ship a feature flag for migration, locking in a public API shape.

Also extract:
  - "constraint": a hard limit or rule that the chosen design must respect.
  - "pattern": a reusable approach the team commits to (e.g. "errors propagate via Result").

Each fact's title is a noun phrase ≤ 15 words.
The summary states what was decided + the reason in one or two sentences.
evidence_text is the smallest verbatim quote that supports it.
If the conversation does not contain a real decision, return {"facts": []}.`,
});

registerAgent(DECISION_AGENT);
