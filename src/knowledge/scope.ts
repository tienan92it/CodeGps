/**
 * Scope helpers. Scope (technical | industry | meta) is a second axis,
 * orthogonal to grounding. Producing agents set it explicitly; for everything
 * else we derive a sensible default from the triage domain.
 */
import type { Scope, Grounding } from '../types.js';

/** Deterministic default scope from a triage/summarizer domain label. */
export function scopeFromDomain(domain?: string | null): Scope {
  switch (domain) {
    case 'business_logic':
      return 'industry';
    case 'architecture':
    case 'implementation':
    case 'debugging':
    case 'devops':
      return 'technical';
    default:
      return 'meta';
  }
}

/** Majority non-null scope across members, or undefined if none set. */
export function dominantScope(values: Array<string | null | undefined>): Scope | undefined {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
  return best as Scope | undefined;
}

const GROUNDING_RANK: Record<Grounding, number> = {
  structural: 5,
  corroborated: 4,
  stated: 3,
  external: 2,
  model: 1,
};

/**
 * Dominant grounding across a set of member groundings — the strongest tier
 * present. NULL members count as 'stated' (legacy default).
 */
export function dominantGrounding(values: Array<string | null | undefined>): Grounding {
  let best: Grounding = 'stated';
  let bestRank = 0;
  for (const v of values) {
    const g = (v ?? 'stated') as Grounding;
    const rank = GROUNDING_RANK[g] ?? 0;
    if (rank > bestRank) { bestRank = rank; best = g; }
  }
  return best;
}
