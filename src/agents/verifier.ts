/**
 * Verifier Agent — periodic sanity check.
 *
 * Given two facts that share a concept, decides whether they CONTRADICT,
 * are CONSISTENT, or one SUPERSEDES the other. The pipeline writes a
 * `contradicts` or `supersedes` k_edge for non-consistent pairs.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

export interface VerifierPayload {
  a: { id: string; kind: string; title: string; summary?: string; ts?: number };
  b: { id: string; kind: string; title: string; summary?: string; ts?: number };
}

export interface VerifierOutput {
  verdict: 'consistent' | 'contradicts' | 'a_supersedes_b' | 'b_supersedes_a';
  confidence: number;
  reason: string;
}

const SYSTEM = `You verify whether two facts within the same concept are mutually consistent.

Possible verdicts:
  consistent         — both facts can be simultaneously true; no conflict.
  contradicts        — they assert incompatible things about the same subject.
  a_supersedes_b     — A is a newer revision that replaces B (e.g. "use JWT" replacing "use sessions").
  b_supersedes_a     — B is a newer revision that replaces A.

Be conservative — return "consistent" unless the conflict or supersession is clear.
Return STRICT JSON: {"verdict":"...","confidence":0.0,"reason":"..."}.`;

export const VERIFIER_AGENT: Agent<VerifierPayload, VerifierOutput> = {
  name: 'verifier',
  promptVersion: 1,
  schema: {
    type: 'object',
    required: ['verdict', 'confidence', 'reason'],
    properties: {
      verdict: { enum: ['consistent', 'contradicts', 'a_supersedes_b', 'b_supersedes_a'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reason: { type: 'string', maxLength: 400 },
    },
    additionalProperties: false,
  },
  prompt(input: AgentInput<VerifierPayload>): ChatMessage[] {
    const { a, b } = input.payload;
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `FACT A:\n  kind: ${a.kind}\n  title: ${a.title}\n` +
          (a.summary ? `  summary: ${a.summary}\n` : '') +
          (a.ts ? `  created_at: ${new Date(a.ts).toISOString()}\n` : '') +
          `\nFACT B:\n  kind: ${b.kind}\n  title: ${b.title}\n` +
          (b.summary ? `  summary: ${b.summary}\n` : '') +
          (b.ts ? `  created_at: ${new Date(b.ts).toISOString()}\n` : '') +
          `\nReturn JSON only.`,
      },
    ];
  },
};

registerAgent(VERIFIER_AGENT);
