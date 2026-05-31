/**
 * Second-brain substrate tests (deterministic, no LLM):
 *   - manifest parser → dependency/tool facts (scope=technical, structural)
 *   - entity reconciler → corroborated grounding + same_as edge
 *   - skill graph export + synthesis (incl. cross-project aggregation)
 *   - scope / grounding filtering on recall
 *   - agent postprocess evidence enforcement (technical profiler, enricher)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openKnowledgeDb, openCodeDb, openGlobalDb } from '../../src/db/connection';
import { syncProject } from '../../src/code/sync';
import { runManifestParser } from '../../src/pipeline/manifests';
import { runEntityReconciler, normalizeEntityName } from '../../src/pipeline/reconcile';
import { exportProjectSkills, synthesizeSkills, listSkills, normalizeSkill } from '../../src/global/skills';
import { recallByQuery } from '../../src/mcp/queries';
import { TECHNICAL_PROFILER_AGENT } from '../../src/agents/technical-profiler';
import { INDUSTRY_ENRICHER_AGENT } from '../../src/agents/industry-enricher';

describe('manifest parser', () => {
  it('extracts dependencies and infra tools as technical/structural facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-man-'));
    const db = openKnowledgeDb(root);
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        dependencies: { react: '^18', express: '^4' },
        devDependencies: { typescript: '^5' },
      }));
      writeFileSync(join(root, 'Dockerfile'), 'FROM node:20');
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');

      const stats = runManifestParser(db, root);
      expect(stats.dependencies).toBe(3);
      expect(stats.tools).toBeGreaterThanOrEqual(2); // Docker + GitHub Actions

      const deps = db.prepare(`SELECT title, scope, grounding, source FROM k_nodes WHERE kind='dependency'`).all() as any[];
      expect(deps.map((d) => d.title).sort()).toEqual(['express', 'react', 'typescript']);
      for (const d of deps) {
        expect(d.scope).toBe('technical');
        expect(d.grounding).toBe('structural');
        expect(d.source).toBe('structural:manifest');
      }
      const tools = (db.prepare(`SELECT title FROM k_nodes WHERE kind='tool'`).all() as any[]).map((t) => t.title);
      expect(tools).toEqual(expect.arrayContaining(['Docker', 'GitHub Actions']));
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-man-'));
    const db = openKnowledgeDb(root);
    try {
      writeFileSync(join(root, 'go.mod'), 'module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)');
      runManifestParser(db, root);
      runManifestParser(db, root);
      const n = (db.prepare(`SELECT COUNT(*) AS n FROM k_nodes WHERE kind='dependency'`).get() as any).n;
      expect(n).toBe(1);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('entity reconciler', () => {
  it('matches stated and structural entities by normalized name → corroborated + same_as', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-rec-'));
    const db = openKnowledgeDb(root);
    try {
      const now = Date.now();
      // structural entity "accounts" (from code) and stated entity "Account" (from chat)
      db.prepare(`INSERT INTO k_nodes (id,kind,title,confidence,source,grounding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run('s1', 'entity', 'accounts', 1, 'structural:code', 'structural', now, now);
      db.prepare(`INSERT INTO k_nodes (id,kind,title,confidence,source,grounding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run('c1', 'entity', 'Account', 0.9, 'agent:businessLogic', 'stated', now, now);

      const stats = runEntityReconciler(db);
      expect(stats.matched).toBe(1);

      const s1 = db.prepare(`SELECT grounding, scope FROM k_nodes WHERE id='s1'`).get() as any;
      const c1 = db.prepare(`SELECT grounding, scope FROM k_nodes WHERE id='c1'`).get() as any;
      expect(s1.grounding).toBe('corroborated');
      expect(c1.grounding).toBe('corroborated');
      expect(s1.scope).toBe('industry');

      const edge = db.prepare(`SELECT source, target, kind FROM k_edges WHERE kind='same_as'`).get() as any;
      expect(edge).toBeTruthy();
      expect(edge.source).toBe('c1');
      expect(edge.target).toBe('s1');
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes plural/case for matching', () => {
    expect(normalizeEntityName('Accounts')).toBe(normalizeEntityName('account'));
    expect(normalizeEntityName('User')).toBe(normalizeEntityName('users'));
  });
});

describe('skill graph', () => {
  let tempHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'cg-home-'));
    origHome = process.env.HOME;
    process.env.HOME = tempHome;
  });
  afterEach(() => {
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function makeProject(dep: string): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), 'cg-proj-'));
    writeFileSync(join(root, 'app.ts'), 'export const x = 1;');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { [dep]: '^1' } }));
    await syncProject(root);
    const know = openKnowledgeDb(root);
    runManifestParser(know, root);
    know.close();
    return root;
  }

  it('aggregates skills across projects with cross-project counts', async () => {
    const a = await makeProject('react');
    const b = await makeProject('react'); // shared dependency
    try {
      await exportProjectSkills(a);
      await exportProjectSkills(b);
      const gdb = openGlobalDb();
      const synth = synthesizeSkills(gdb);
      expect(synth.skills).toBeGreaterThan(0);

      const skills = listSkills(gdb, { scope: 'technical' });
      const react = skills.find((s) => normalizeSkill(s.name) === 'react');
      expect(react).toBeTruthy();
      expect(react!.projectCount).toBe(2);          // shared across both projects
      expect(synth.crossProject).toBeGreaterThanOrEqual(1);

      // typescript language is present in both (the .ts file) → also cross-project
      const ts = skills.find((s) => normalizeSkill(s.name) === 'typescript');
      expect(ts?.projectCount).toBe(2);
      gdb.close();
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('recall grounding/scope filtering', () => {
  function seed(db: any, id: string, kind: string, scope: string, grounding: string) {
    db.prepare(`INSERT INTO k_nodes (id,kind,title,summary,confidence,source,scope,grounding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, kind, `payments ${id}`, 'about payments', 0.9, 'agent:test', scope, grounding, Date.now(), Date.now());
  }

  it('excludes enrichment tiers by default, includes them on request, and filters by scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-recall-'));
    const db = openKnowledgeDb(root);
    try {
      seed(db, 'a', 'business_rule', 'industry', 'corroborated'); // project truth
      seed(db, 'b', 'glossary_term', 'industry', 'model');        // enrichment
      seed(db, 'c', 'glossary_term', 'industry', 'external');     // enrichment
      seed(db, 'd', 'skill', 'technical', 'structural');          // technical

      const truth = recallByQuery(db, 'payments');
      expect(truth.map((r) => r.id).sort()).toEqual(['a', 'd']); // no model/external

      const all = recallByQuery(db, 'payments', 20, { includeEnrichment: true });
      expect(all.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd']);

      const industryTruth = recallByQuery(db, 'payments', 20, { scope: 'industry' });
      expect(industryTruth.map((r) => r.id)).toEqual(['a']);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agent evidence enforcement', () => {
  it('technical profiler drops skills whose evidence is not a declared dependency/language', () => {
    const post = TECHNICAL_PROFILER_AGENT.postprocess!(
      {
        skills: [
          { name: 'React frontend', kind: 'framework', evidence: 'react' },      // keep
          { name: 'Made-up skill', kind: 'framework', evidence: 'nonexistent' }, // drop
        ],
      },
      { payload: { languages: [{ name: 'typescript', files: 3 }], dependencies: ['react'], tools: [] } },
    );
    expect(post.output.skills).toHaveLength(1);
    expect(post.output.skills[0].name).toBe('React frontend');
  });

  it('industry enricher requires title/description/basis on every item', () => {
    const post = INDUSTRY_ENRICHER_AGENT.postprocess!(
      {
        items: [
          { title: 'KYC checks', description: 'verify identity', basis: 'standard in fintech' }, // keep
          { title: '', description: 'x', basis: 'y' },                                            // drop
        ],
      },
      { payload: { industry: 'fintech', knownConcepts: [] } },
    );
    expect(post.output.items).toHaveLength(1);
    expect(post.output.items[0].title).toBe('KYC checks');
  });
});
