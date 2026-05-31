/**
 * TechnicalProfiler Agent.
 *
 * Synthesizes higher-level technical skills/competencies from objective inputs:
 * the project's language histogram (L0) and its declared dependencies / infra
 * (manifest facts). It groups raw evidence into named skills — e.g. react +
 * react-dom + next -> "React / Next.js frontend".
 *
 * Grounding rule: every skill MUST cite a verbatim language, dependency, or
 * tool from the input. Postprocess drops any skill whose evidence isn't in the
 * provided lists — the synthesis is allowed only because it rests on a declared
 * fact. Output is grounding='structural', scope='technical'.
 */
import type { Agent, AgentInput } from './runtime.js';
import type { ChatMessage } from './backends/base.js';
import { registerAgent } from './registry.js';

const SKILL_KINDS = ['language', 'framework', 'library', 'infra', 'pattern'] as const;
type SkillKind = (typeof SKILL_KINDS)[number];

export interface TechProfilerPayload {
  languages: Array<{ name: string; files: number }>;
  dependencies: string[];
  tools: string[];
}

export interface TechSkill {
  name: string;
  kind: SkillKind;
  evidence: string;       // a verbatim language / dependency / tool — required
}

export interface TechProfilerOutput {
  skills: TechSkill[];
}

const SYSTEM = `You profile the TECHNICAL skills a project demonstrates, from objective inputs:
its programming languages (with file counts), declared dependencies, and infra tools.

Produce STRICT JSON: { "skills": [ { "name", "kind", "evidence" } ] }.
  kind ∈ language | framework | library | infra | pattern
  Group related evidence into one named skill (e.g. "react" + "next" -> "React / Next.js").
  "evidence" MUST be a verbatim item from the provided languages, dependencies, or tools.

Hard rules:
  - Never invent a dependency, language, or tool. Only reference what is listed.
  - One skill per real competency; do not pad.
  - If a skill is not backed by a listed item, omit it.
  - If nothing is supported, return {"skills": []}.

Return JSON only. No prose, no fences.`;

export const TECHNICAL_PROFILER_AGENT: Agent<TechProfilerPayload, TechProfilerOutput> = {
  name: 'technicalProfiler',
  promptVersion: 1,
  schema: {
    type: 'object',
    required: ['skills'],
    properties: {
      skills: {
        type: 'array',
        maxItems: 40,
        items: {
          type: 'object',
          required: ['name', 'kind', 'evidence'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            kind: { enum: SKILL_KINDS as unknown as string[] },
            evidence: { type: 'string', minLength: 1, maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  prompt(input: AgentInput<TechProfilerPayload>): ChatMessage[] {
    const { languages, dependencies, tools } = input.payload;
    const langs = languages.length
      ? languages.map((l) => `${l.name} (${l.files} files)`).join(', ')
      : '(none)';
    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `LANGUAGES: ${langs}\n` +
          `DEPENDENCIES: ${dependencies.slice(0, 200).join(', ') || '(none)'}\n` +
          `TOOLS: ${tools.join(', ') || '(none)'}\n\nReturn JSON only.`,
      },
    ];
  },
  postprocess(o: TechProfilerOutput, input) {
    const allowed = new Set<string>();
    for (const l of input.payload.languages) allowed.add(l.name.toLowerCase());
    for (const d of input.payload.dependencies) allowed.add(d.toLowerCase());
    for (const t of input.payload.tools) allowed.add(t.toLowerCase());
    const skills = (o.skills ?? []).filter(
      (s) =>
        s.name?.trim() &&
        (SKILL_KINDS as readonly string[]).includes(s.kind) &&
        s.evidence?.trim() &&
        // evidence must reference something actually declared
        [...allowed].some((a) => s.evidence.toLowerCase().includes(a) || a.includes(s.evidence.toLowerCase())),
    );
    const total = o.skills?.length ?? 0;
    return { output: { skills }, confidence: total === 0 ? 0 : skills.length / total };
  },
};

registerAgent(TECHNICAL_PROFILER_AGENT);
