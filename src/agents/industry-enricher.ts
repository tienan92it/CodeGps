/**
 * IndustryEnricher Agent.
 *
 * Given a classified industry and the domain knowledge the project HAS already
 * documented, it proposes industry-standard concepts/rules the project plausibly
 * involves but has NOT documented. These are explicit gap-fills:
 *   - grounding='model' (the agent's parametric knowledge; an inference)
 *   - scope='industry'
 *   - each is simultaneously a learning target (something not demonstrated)
 *
 * This is the "fill the gap from the agent's awareness" path. It NEVER claims
 * these are facts about the user's project — they are general industry knowledge,
 * stored in a separate grounding tier so they never blur with real work. The
 * optional ResearchBackend later upgrades a `model` item to `external` with a URL.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

export interface IndustryEnricherPayload {
  industry: string;
  knownConcepts: string[];   // what the project already documents (to avoid repeating)
}

export interface IndustryStandardItem {
  title: string;
  description: string;
  basis: string;             // why this is standard in the industry
}

export interface IndustryEnricherOutput {
  items: IndustryStandardItem[];
}

const SYSTEM = `You list standard concepts, rules, and practices that are common in a given
INDUSTRY but are NOT yet present in the project's documented knowledge. These are
general industry knowledge — explicitly NOT claims about this specific project.

Return STRICT JSON: { "items": [ { "title", "description", "basis" } ] }.
  - title: the concept/rule/practice (e.g. "Know Your Customer (KYC) checks").
  - description: 1-2 sentences of what it is.
  - basis: why it is standard in this industry (your justification).

Hard rules:
  - Do NOT repeat anything already in the project's KNOWN list.
  - Do NOT assert these exist in the project. They are industry-standard knowledge.
  - Prefer high-signal, widely-applicable concepts over niche trivia. Max 15.
  - If the industry is "unknown" or you have nothing solid, return {"items": []}.

Return JSON only. No prose, no fences.`;

export const INDUSTRY_ENRICHER_AGENT: Agent<IndustryEnricherPayload, IndustryEnricherOutput> = {
  name: 'industryEnricher',
  promptVersion: 1,
  schema: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        maxItems: 15,
        items: {
          type: 'object',
          required: ['title', 'description', 'basis'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: 'string', minLength: 1, maxLength: 600 },
            basis: { type: 'string', minLength: 1, maxLength: 400 },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  prompt(input: AgentInput<IndustryEnricherPayload>): ChatMessage[] {
    const { industry, knownConcepts } = input.payload;
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `INDUSTRY: ${industry}\n\n` +
          `KNOWN (already documented — do not repeat):\n` +
          (knownConcepts.slice(0, 80).map((c) => `  - ${c}`).join('\n') || '  (none)') +
          `\n\nReturn JSON only.`,
      },
    ];
  },
  postprocess(o: IndustryEnricherOutput, _input) {
    const items = (o.items ?? []).filter((i) => i.title?.trim() && i.description?.trim() && i.basis?.trim());
    return { output: { items }, confidence: items.length ? 0.5 : 0 };
  },
};

registerAgent(INDUSTRY_ENRICHER_AGENT);
