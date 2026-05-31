/**
 * IndustryClassifier Agent.
 *
 * Names the industry/business domain a project serves from WHATEVER evidence
 * exists — README, package metadata, dependencies, code symbols (components /
 * routes / types), domain entities, business rules. It does not require any
 * single source, so frontend / library / data projects classify just as well
 * as schema-heavy backends. Every label cites the evidence it rests on.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

export interface IndustryClassifierPayload {
  readme?: string;
  projectName?: string;
  description?: string;
  dependencies: string[];
  symbols: string[];        // notable code symbols: components, routes, types, classes
  entities: string[];
  businessRules: string[];
}

export interface IndustryClassifierOutput {
  industry: string;
  confidence: number;
  domains: string[];
  evidence: string;
}

const SYSTEM = `You identify the INDUSTRY / business domain a software project serves, using any
of the supplied evidence: README, package name/description, dependencies, code
symbols (components, routes, types, classes), domain entities, business rules.

This works for any project type. Examples of grounded inference:
  - deps {stripe, plaid} + symbols {Wallet, Ledger}      -> "fintech / payments"
  - deps {mapbox, twilio} + symbols {Driver, Trip}       -> "logistics / ride-hailing"
  - symbols {Patient, Appointment} + dep {fhir}          -> "healthcare / telehealth"
  - frontend deps {next, tailwind} + symbols {Cart, SKU} -> "e-commerce frontend"

Return STRICT JSON: { "industry", "confidence", "domains", "evidence" }.
  - industry: a concise label.
  - confidence: 0..1; lower it when evidence is thin or only technical.
  - domains: 1-5 sub-domain tags grounded in the evidence.
  - evidence: the specific deps / symbols / quotes that justify the label.

Hard rules:
  - Base the label only on supplied evidence. Cite what you used.
  - Classify the domain, not a specific company/brand.
  - Generic tech alone (react, express) is weak signal — combine with symbols/deps.
  - Only return industry "unknown" if there is genuinely no domain signal at all.

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
    const { readme, projectName, description, dependencies, symbols, entities, businessRules } = input.payload;
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          (projectName ? `PROJECT: ${projectName}\n` : '') +
          (description ? `DESCRIPTION: ${description}\n` : '') +
          (readme ? `README (excerpt):\n${readme.slice(0, 1500)}\n\n` : '') +
          `DEPENDENCIES: ${dependencies.slice(0, 80).join(', ') || '(none)'}\n` +
          `CODE SYMBOLS: ${symbols.slice(0, 80).join(', ') || '(none)'}\n` +
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
