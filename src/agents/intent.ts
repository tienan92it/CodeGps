/**
 * Intent Agent — extracts the user's high-level goals and sub-goals from a
 * window. Useful for answering "what was the user trying to do?" after the fact.
 */
import { defineExtractor } from './extractors-common.js';
import { registerAgent } from './registry.js';

export const INTENT_AGENT = defineExtractor({
  name: 'intent',
  allowedKinds: ['intent'],
  systemPrompt: `You extract USER INTENT from a developer/AI conversation.

An intent is what the user is trying to achieve — at the goal level, not the
keystroke level. Examples:
  - "Migrate the auth flow from sessions to JWT"
  - "Speed up the dashboard load on the orders page"
  - "Reproduce the flaky test in CI"

Capture up to 3 intents per window: usually one primary plus any clearly stated
sub-goals. Title is an imperative phrase (verb + object). summary is one sentence.
evidence_text quotes the user's framing.
If the window has no clear user intent (e.g. assistant-only output, chitchat),
return {"facts": []}.`,
});

registerAgent(INTENT_AGENT);
