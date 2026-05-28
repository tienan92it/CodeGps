/**
 * Triage runner. For each newly-created window, run the Triage Agent and
 * persist its labels. After triage, embed kept windows via the Dedupe Agent
 * so downstream extractors and the clusterer can use similarity.
 *
 * Pipeline contract:
 *   - One agent call per window (cached by content).
 *   - Errors from the agent are logged and treated as "kept" with low
 *     confidence so we don't silently drop content when the LLM is down.
 *   - Embedding failures are non-fatal: the window stays kept, just without
 *     an embedding (downstream falls back to lexical similarity).
 */
import type { Database as SqliteDb } from 'better-sqlite3';
import type { CodeGpsConfig } from '../config.js';
import { AgentRuntime } from '../agents/runtime.js';
// Ensure agents register themselves.
import '../agents/index.js';
import { TRIAGE_AGENT, shouldKeep, labelsToRow } from '../agents/triage.js';
import { DedupeAgent, storeWindowEmbedding } from '../agents/dedupe.js';
import { upsertTriageLabels, getWindowText } from '../knowledge/triage-store.js';

export interface TriageRunResult {
  triaged: number;
  kept: number;
  dropped: number;
  keptWindowIds: string[];
  embedded: number;
  duplicateWindows: number;
}

export async function runTriageForWindows(
  _root: string, db: SqliteDb, cfg: CodeGpsConfig, windowIds: string[],
): Promise<TriageRunResult> {
  const rt = new AgentRuntime({ knowledgeDb: db, config: cfg });
  const result: TriageRunResult = {
    triaged: 0, kept: 0, dropped: 0, keptWindowIds: [],
    embedded: 0, duplicateWindows: 0,
  };

  for (const windowId of windowIds) {
    const text = getWindowText(db, windowId);
    if (!text) continue;
    try {
      const out = await rt.run(TRIAGE_AGENT, { payload: { text, windowId } });
      const kept = shouldKeep(out.output);
      upsertTriageLabels(db, labelsToRow(windowId, out.model, out.output, kept));
      result.triaged++;
      if (kept) {
        result.kept++;
        result.keptWindowIds.push(windowId);
      } else {
        result.dropped++;
      }
    } catch (e) {
      const fallback = labelsToRow(windowId, 'fallback', {
        relevance: 'unknown', domain: 'unknown', quality: 'signal', linkage: 'this_project',
        confidence: 0.1,
        rationale: `triage agent failed: ${(e as Error).message.slice(0, 200)}`,
      }, true);
      upsertTriageLabels(db, fallback);
      result.triaged++;
      result.kept++;
      result.keptWindowIds.push(windowId);
    }
  }

  // Dedupe pass: embed kept windows and flag near-duplicates of prior windows.
  if (result.keptWindowIds.length > 0) {
    try {
      const dedupe = new DedupeAgent(cfg);
      const newOnly = new Set(result.keptWindowIds);
      const novelKept: string[] = [];
      for (const id of result.keptWindowIds) {
        const text = getWindowText(db, id);
        if (!text) continue;
        let v: Float32Array;
        try { v = await dedupe.embedText(text); }
        catch { novelKept.push(id); continue; }
        storeWindowEmbedding(db, id, v);
        result.embedded++;
        // Find duplicates among already-embedded windows (excluding self).
        const dups = dedupe.nearestWindow(db, v, 1, 0.92, [...newOnly]);
        if (dups.length > 0) {
          result.duplicateWindows++;
          // We mark by re-labeling the triage row's rationale; the downstream
          // extractor will skip windows whose rationale carries the dup marker.
          db.prepare(`UPDATE triage_labels SET rationale = COALESCE(rationale,'') || ' [dup_of:' || ? || ']' WHERE window_id=?`)
            .run(dups[0].id, id);
        } else {
          novelKept.push(id);
        }
      }
      // Downstream extractors only see novel kept windows.
      result.keptWindowIds = novelKept;
    } catch (e) {
      // Dedupe backend unavailable: leave keptWindowIds as-is, downstream
      // extractors will just process everything.
    }
  }

  return result;
}
