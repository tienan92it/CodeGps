/**
 * Mechanical cross-project linking.
 *
 * Cheap, no-agent heuristics:
 *   - Exact name match (case-insensitive) across projects.
 *   - Domain agreement (same domain) bumps confidence.
 *
 * Future: SimHash on code body via k_to_code, shared library imports.
 */
import type { Database as SqliteDb } from 'better-sqlite3';

export interface MechanicalStats {
  pairsConsidered: number;
  linksWritten: number;
}

export function runMechanicalLinking(gdb: SqliteDb): MechanicalStats {
  const stats: MechanicalStats = { pairsConsidered: 0, linksWritten: 0 };
  // Find concept names shared across >= 2 projects.
  const groups = gdb.prepare(`
    SELECT lower(name) AS lname, COUNT(DISTINCT project_id) AS projects
    FROM concepts_global
    GROUP BY lower(name)
    HAVING projects >= 2
  `).all() as Array<{ lname: string; projects: number }>;

  const insert = gdb.prepare(`
    INSERT INTO concept_links (a, b, kind, score, source, metadata)
    VALUES (?, ?, 'same_as', ?, 'mechanical', ?)
    ON CONFLICT(a, b, kind, source) DO UPDATE SET score=excluded.score
  `);
  const fetch = gdb.prepare(`
    SELECT id, project_id, domain FROM concepts_global WHERE lower(name)=?
  `);

  const tx = gdb.transaction(() => {
    for (const g of groups) {
      const members = fetch.all(g.lname) as Array<{ id: string; project_id: string; domain: string | null }>;
      // All-pairs O(n^2); n is small (per-name occurrence count).
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i], b = members[j];
          if (a.project_id === b.project_id) continue;
          stats.pairsConsidered++;
          let score = 0.6; // base for name match
          if (a.domain && b.domain && a.domain === b.domain) score += 0.2;
          const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
          insert.run(low, high, score, JSON.stringify({ via: 'name_exact' }));
          stats.linksWritten++;
        }
      }
    }
  });
  tx();

  return stats;
}
