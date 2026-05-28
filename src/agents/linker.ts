/**
 * Linker Agent — decides the relationship between two cross-project concepts.
 *
 * Inputs are TWO concept descriptions; output is the relationship (or "none").
 * The mechanical pass proposes candidates by embedding similarity; this agent
 * decides whether they actually represent the same idea.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

export interface LinkerPayload {
  a: { id: string; name: string; summary?: string; domain?: string; project: string };
  b: { id: string; name: string; summary?: string; domain?: string; project: string };
}

export interface LinkerOutput {
  relation: 'same_as' | 'variant_of' | 'supersedes' | 'contradicts' | 'none';
  confidence: number;
  reason: string;
}

const SYSTEM = `You judge whether two concepts (each from a different project) refer to the same idea.

Possible relations:
  same_as     — both concepts describe the same idea / decision / rule.
  variant_of  — same family but materially different (e.g. "JWT auth" vs "session auth").
  supersedes  — one is a newer revision of the other (rare; usually requires explicit cues).
  contradicts — they make incompatible claims about the same topic.
  none        — they share only superficial wording; not really related.

Return STRICT JSON: {"relation":"...","confidence":0.0,"reason":"..."}.
Use "none" liberally — over-linking is worse than under-linking.`;

export const LINKER_AGENT: Agent<LinkerPayload, LinkerOutput> = {
  name: 'linker',
  promptVersion: 1,
  schema: {
    type: 'object',
    required: ['relation', 'confidence', 'reason'],
    properties: {
      relation: { enum: ['same_as', 'variant_of', 'supersedes', 'contradicts', 'none'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reason: { type: 'string', maxLength: 400 },
    },
    additionalProperties: false,
  },
  prompt(input: AgentInput<LinkerPayload>): ChatMessage[] {
    const { a, b } = input.payload;
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `CONCEPT A (project ${a.project}):\n` +
          `  name: ${a.name}\n` +
          (a.domain ? `  domain: ${a.domain}\n` : '') +
          (a.summary ? `  summary: ${a.summary}\n` : '') +
          `\nCONCEPT B (project ${b.project}):\n` +
          `  name: ${b.name}\n` +
          (b.domain ? `  domain: ${b.domain}\n` : '') +
          (b.summary ? `  summary: ${b.summary}\n` : '') +
          `\nReturn JSON only.`,
      },
    ];
  },
};

registerAgent(LINKER_AGENT);
