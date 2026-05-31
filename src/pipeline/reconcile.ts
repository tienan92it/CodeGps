/**
 * Entity Reconciler (deterministic).
 *
 * Conversation-stated entities (from the BusinessLogic agent) and structural
 * entities (from code via domain-from-code) frequently describe the same
 * business object — "the Account entity" and the `accounts` table. They live
 * as separate `entity` nodes. This pass matches them by normalized name and
 * links them with a `same_as` edge.
 *
 * When a stated entity and a structural entity agree, BOTH are upgraded to
 * grounding='corroborated' — two independent sources confirm the same fact.
 * This is the only producer of the `corroborated` tier; without it the tier is
 * defined but never emitted.
 *
 * All domain entities are tagged scope='industry' (they model the business
 * domain, regardless of which source revealed them).
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import { insertKEdgeUnique, setGroundingScope } from '../knowledge/store.js';

export interface ReconcileStats {
  structuralEntities: number;
  statedEntities: number;
  matched: number;
  corroborated: number;
}

/** Normalize a name for matching: lowercase, alnum-only, singularize trailing 's'. */
export function normalizeEntityName(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n.length > 3 && n.endsWith('s')) n = n.slice(0, -1);
  return n;
}

export function runEntityReconciler(knowDb: SqliteDb): ReconcileStats {
  const stats: ReconcileStats = { structuralEntities: 0, statedEntities: 0, matched: 0, corroborated: 0 };

  const structural = knowDb.prepare(`
    SELECT id, title FROM k_nodes
    WHERE kind='entity' AND source LIKE 'structural:code%'
  `).all() as Array<{ id: string; title: string }>;
  stats.structuralEntities = structural.length;

  const stated = knowDb.prepare(`
    SELECT id, title FROM k_nodes
    WHERE kind='entity' AND source NOT LIKE 'structural:code%'
  `).all() as Array<{ id: string; title: string }>;
  stats.statedEntities = stated.length;

  if (structural.length === 0) return stats;

  // Index structural entities by normalized name.
  const byName = new Map<string, { id: string; title: string }>();
  for (const s of structural) {
    const key = normalizeEntityName(s.title);
    if (key && !byName.has(key)) byName.set(key, s);
  }

  const tx = knowDb.transaction(() => {
    // All structural domain entities are industry-scoped.
    for (const s of structural) setGroundingScope(knowDb, s.id, undefined, 'industry');

    for (const st of stated) {
      const match = byName.get(normalizeEntityName(st.title));
      if (!match || match.id === st.id) continue;

      insertKEdgeUnique(knowDb, {
        source: st.id, target: match.id, kind: 'same_as', weight: 1,
        metadata: { via: 'name_match', basis: `"${st.title}" ~ "${match.title}"` },
      });
      // Two independent sources agree → corroborated.
      setGroundingScope(knowDb, match.id, 'corroborated', 'industry');
      setGroundingScope(knowDb, st.id, 'corroborated', 'industry');
      stats.matched++;
      stats.corroborated += 2;
    }
  });
  tx();

  return stats;
}
