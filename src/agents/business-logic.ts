/**
 * BusinessLogic Agent — extracts domain rules, invariants, entities, and
 * business-side constraints. Runs only on windows whose triage domain is
 * "business_logic" or "architecture".
 */
import { defineExtractor } from './extractors-common.js';
import { registerAgent } from './registry.js';

export const BUSINESS_LOGIC_AGENT = defineExtractor({
  name: 'businessLogic',
  allowedKinds: ['business_rule', 'entity', 'constraint', 'pattern'],
  systemPrompt: `You extract BUSINESS LOGIC from a developer/AI conversation.

Look for:
  - "business_rule": rules the domain imposes (e.g. "refunds older than 180 days must
    use store credit", "a user can be member of at most one workspace at a time").
  - "entity": named domain objects with structure or lifecycle (e.g. "Refund has
    states pending -> succeeded -> failed").
  - "constraint": invariants that must always hold (e.g. "total allocation never
    exceeds 100%").
  - "pattern": recurring shapes that codify business intent (e.g. "every
    money-moving operation logs an idempotency key").

Do NOT extract:
  - Pure implementation details (variable names, function signatures, refactors).
  - Generic engineering best practice.
  - Restated questions or chitchat.

Each fact's title is a domain-language noun phrase. summary states the rule clearly
in one or two sentences. evidence_text quotes the smallest supporting passage.
If no business logic is present, return {"facts": []}.`,
});

registerAgent(BUSINESS_LOGIC_AGENT);
