/**
 * Clusterer Agent.
 *
 * Given a candidate L2 fact and up to K nearby existing concepts (selected
 * mechanically by embedding similarity + code overlap), decides what to do:
 *   - attach  : add the fact to an existing concept
 *   - create  : the fact starts a new concept
 *   - merge   : two existing concepts represent the same idea; merge them and
 *               attach the fact to the merged concept
 *
 * Split is currently out of scope (would require revisiting prior placements);
 * the Verifier Agent (M10) is the place for that.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

export interface ClustererCandidate {
  id: string;
  name: string;
  summary?: string;
}

export interface ClustererPayload {
  fact: { id: string; kind: string; title: string; summary?: string };
  candidates: ClustererCandidate[];
}

export type ClustererAction =
  | { action: 'attach'; conceptId: string; confidence: number; reason: string }
  | { action: 'create'; suggestedName: string; confidence: number; reason: string }
  | { action: 'merge'; conceptIds: [string, string]; suggestedName: string; confidence: number; reason: string };

const SYSTEM = `You are a concept clusterer. Given a new fact and up to 5 nearby existing concepts,
decide whether the fact:
  - "attach"   to an existing concept (specify conceptId)
  - "create"   a new concept (specify suggestedName: 3-6 word noun phrase)
  - "merge"    two existing concepts and attach the fact to the merged one
              (specify conceptIds[2] + suggestedName)

Default to "create" when no candidate is clearly the same idea.
Default to "attach" when one candidate clearly subsumes the new fact's topic.
Use "merge" only when two existing concepts ARE the same idea (rare).

Return STRICT JSON. Examples:
{"action":"attach","conceptId":"c1","confidence":0.85,"reason":"same caching decision"}
{"action":"create","suggestedName":"refund finality rule","confidence":0.9,"reason":"new domain rule"}
{"action":"merge","conceptIds":["c1","c2"],"suggestedName":"session storage","confidence":0.7,"reason":"both about session backends"}`;

export const CLUSTERER_AGENT: Agent<ClustererPayload, ClustererAction> = {
  name: 'clusterer',
  promptVersion: 1,
  schema: {
    oneOf: [
      {
        type: 'object',
        required: ['action', 'conceptId', 'confidence', 'reason'],
        properties: {
          action: { const: 'attach' },
          conceptId: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', maxLength: 400 },
        },
        additionalProperties: false,
      },
      {
        type: 'object',
        required: ['action', 'suggestedName', 'confidence', 'reason'],
        properties: {
          action: { const: 'create' },
          suggestedName: { type: 'string', minLength: 1, maxLength: 120 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', maxLength: 400 },
        },
        additionalProperties: false,
      },
      {
        type: 'object',
        required: ['action', 'conceptIds', 'suggestedName', 'confidence', 'reason'],
        properties: {
          action: { const: 'merge' },
          conceptIds: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
          suggestedName: { type: 'string', minLength: 1, maxLength: 120 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', maxLength: 400 },
        },
        additionalProperties: false,
      },
    ],
  },
  prompt(input: AgentInput<ClustererPayload>): ChatMessage[] {
    const { fact, candidates } = input.payload;
    const candText = candidates.length
      ? candidates.map((c, i) => `  ${i + 1}. id="${c.id}" name="${c.name}"${c.summary ? `\n     summary: ${c.summary}` : ''}`).join('\n')
      : '  (no nearby candidates)';
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `NEW FACT:\n  kind: ${fact.kind}\n  title: ${fact.title}\n` +
          (fact.summary ? `  summary: ${fact.summary}\n` : '') +
          `\nNEARBY CONCEPTS:\n${candText}\n\nReturn JSON only.`,
      },
    ];
  },
};

registerAgent(CLUSTERER_AGENT);
