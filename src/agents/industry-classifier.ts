/**
 * IndustryClassifier Agent.
 *
 * Names the industry/business domain a project serves, grounded in project
 * evidence (README, domain entities, business rules, conversation summaries).
 * It must cite the evidence it used and report a confidence. This is a judgment,
 * so it is never treated as authoritative beyond its cited basis.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

export interface IndustryClassifierPayload {
  readme?: string;
  entities: string[];
  businessRules: string[];
}

export interface IndustryClassifierOutput {
  industry: string;
  confidence: number;
  domains: string[];
  evidence: string;
}

const SYSTEM = `You identify the INDUSTRY / business domain a software project serves, using only
the supplied evidence (README excerpt, domain entities, business rules).

Return STRICT JSON: { "industry", "confidence", "domains", "evidence" }.
  - industry: a concise label (e.g. "crypto derivatives trading", "B2B logistics", "telehealth").
  - confidence: 0..1, honest about how strongly the evidence supports the label.
  - domains: 1-5 sub-domain tags present in the evidence.
  - evidence: a short verbatim quote / entity list that justifies the label.

Hard rules:
  - Base the label only on supplied evidence. If evidence is thin, lower confidence.
  - Do not guess a specific company or product. Classify the domain, not the brand.
  - If you genuinely cannot tell, use industry "unknown" with low confidence.

Return JSON only. No prose, no fences.`;

export const INDUSTRY_CLASSIFIER_AGENT: Agent<IndustryClassifierPayload, IndustryClassifierOutput> = {
  name: 'industryClassifier',
  promptVersion: 1,
  schema: {
    type: 'object',
    required: ['industry', 'confidence', 'domains', 'evidence'],
    properties: {
      industry: { type: 'string', minLength: 1, maxLength: 120 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      domains: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      evidence: { type: 'string', maxLength: 800 },
    },
    additionalProperties: false,
  },
  prompt(input: AgentInput<IndustryClassifierPayload>): ChatMessage[] {
    const { readme, entities, businessRules } = input.payload;
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          (readme ? `README (excerpt):\n${readme.slice(0, 2000)}\n\n` : '') +
          `DOMAIN ENTITIES: ${entities.slice(0, 60).join(', ') || '(none)'}\n` +
          `BUSINESS RULES:\n${businessRules.slice(0, 30).map((r) => `  - ${r}`).join('\n') || '  (none)'}\n\n` +
          `Return JSON only.`,
      },
    ];
  },
  postprocess(o: IndustryClassifierOutput, _input) {
    return { output: o, confidence: o.confidence ?? 0.5 };
  },
};

registerAgent(INDUSTRY_CLASSIFIER_AGENT);
