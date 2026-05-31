/**
 * Manifest + infrastructure parser — deterministic, zero-assumption.
 *
 * Reads dependency manifests and infra files from the project root and emits
 * `dependency` and `tool` facts (scope='technical', grounding='structural',
 * source='structural:manifest'). These are leaf evidence — the raw material
 * the TechnicalProfiler agent synthesizes into skill concepts. A declared
 * dependency is an objective fact; no inference.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { Database as SqliteDb } from 'better-sqlite3';
import type { KNode, KNodeKind } from '../types.js';
import { upsertKNode } from '../knowledge/store.js';

export interface ManifestStats {
  dependencies: number;
  tools: number;
}

interface RawFact {
  kind: KNodeKind;          // 'dependency' | 'tool'
  name: string;
  evidence: string;
}

export function runManifestParser(knowDb: SqliteDb, root: string): ManifestStats {
  const facts = new Map<string, RawFact>();   // dedup by kind+name
  const add = (kind: KNodeKind, name: string, evidence: string) => {
    const n = name.trim();
    if (!n) return;
    const key = `${kind}|${n.toLowerCase()}`;
    if (!facts.has(key)) facts.set(key, { kind, name: n, evidence });
  };

  parsePackageJson(root, add);
  parseRequirements(root, add);
  parsePyproject(root, add);
  parseGoMod(root, add);
  parseCargo(root, add);
  parsePubspec(root, add);
  parseComposer(root, add);
  parseGemfile(root, add);
  parsePomXml(root, add);
  parseGradle(root, add);
  parseCsproj(root, add);
  detectInfra(root, add);

  const stats: ManifestStats = { dependencies: 0, tools: 0 };
  const now = Date.now();
  const tx = knowDb.transaction(() => {
    for (const f of facts.values()) {
      const id = createHash('sha1').update(`${f.kind}|${f.name.toLowerCase()}`).digest('hex').slice(0, 16);
      const node: KNode = {
        id, kind: f.kind, title: f.name,
        summary: f.kind === 'dependency' ? `Declared dependency: ${f.name}` : `Tooling/infra: ${f.name}`,
        evidenceText: f.evidence,
        confidence: 1, source: 'structural:manifest', grounding: 'structural', scope: 'technical',
        createdAt: now, updatedAt: now,
      };
      upsertKNode(knowDb, node);
      if (f.kind === 'dependency') stats.dependencies++; else stats.tools++;
    }
  });
  tx();
  return stats;
}

type Add = (kind: KNodeKind, name: string, evidence: string) => void;

function readIf(root: string, rel: string): string | undefined {
  const p = join(root, rel);
  if (!existsSync(p)) return undefined;
  try { return readFileSync(p, 'utf8'); } catch { return undefined; }
}

function parsePackageJson(root: string, add: Add): void {
  const raw = readIf(root, 'package.json');
  if (!raw) return;
  let pkg: any;
  try { pkg = JSON.parse(raw); } catch { return; }
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[section];
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) add('dependency', name, `package.json (${section}): ${name}@${deps[name]}`);
    }
  }
}

function parseRequirements(root: string, add: Add): void {
  const raw = readIf(root, 'requirements.txt');
  if (!raw) return;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('-')) continue;
    const name = t.split(/[=<>!~\[ ]/)[0];
    if (name) add('dependency', name, `requirements.txt: ${t}`);
  }
}

function parsePyproject(root: string, add: Add): void {
  const raw = readIf(root, 'pyproject.toml');
  if (!raw) return;
  // [project] dependencies = ["pkg>=1", ...] or [tool.poetry.dependencies]
  const arrMatch = raw.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arrMatch) {
    for (const m of arrMatch[1].matchAll(/["']([A-Za-z0-9_.\-]+)/g)) {
      add('dependency', m[1], `pyproject.toml: ${m[1]}`);
    }
  }
  const poetry = raw.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
  if (poetry) {
    for (const m of poetry[1].matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=/gm)) {
      if (m[1].toLowerCase() !== 'python') add('dependency', m[1], `pyproject.toml (poetry): ${m[1]}`);
    }
  }
}

function parseGoMod(root: string, add: Add): void {
  const raw = readIf(root, 'go.mod');
  if (!raw) return;
  for (const m of raw.matchAll(/^\s*([a-z0-9.\-]+\/[^\s]+)\s+v[0-9]/gm)) {
    add('dependency', m[1], `go.mod: ${m[1]}`);
  }
}

function parseCargo(root: string, add: Add): void {
  const raw = readIf(root, 'Cargo.toml');
  if (!raw) return;
  const dep = raw.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/);
  if (dep) {
    for (const m of dep[1].matchAll(/^\s*([A-Za-z0-9_\-]+)\s*=/gm)) add('dependency', m[1], `Cargo.toml: ${m[1]}`);
  }
}

function parsePubspec(root: string, add: Add): void {
  const raw = readIf(root, 'pubspec.yaml');
  if (!raw) return;
  const dep = raw.match(/\ndependencies:\s*\n([\s\S]*?)(\n\w|\n*$)/);
  if (dep) {
    for (const m of dep[1].matchAll(/^\s{2}([a-z0-9_]+):/gm)) {
      if (m[1] !== 'flutter') add('dependency', m[1], `pubspec.yaml: ${m[1]}`);
    }
  }
}

function parseComposer(root: string, add: Add): void {
  const raw = readIf(root, 'composer.json');
  if (!raw) return;
  let pkg: any;
  try { pkg = JSON.parse(raw); } catch { return; }
  for (const section of ['require', 'require-dev']) {
    const deps = pkg[section];
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) if (name !== 'php') add('dependency', name, `composer.json (${section}): ${name}`);
    }
  }
}

function parseGemfile(root: string, add: Add): void {
  const raw = readIf(root, 'Gemfile');
  if (!raw) return;
  for (const m of raw.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) add('dependency', m[1], `Gemfile: ${m[1]}`);
}

function parsePomXml(root: string, add: Add): void {
  const raw = readIf(root, 'pom.xml');
  if (!raw) return;
  for (const m of raw.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) add('dependency', m[1], `pom.xml: ${m[1]}`);
}

function parseGradle(root: string, add: Add): void {
  const raw = readIf(root, 'build.gradle') ?? readIf(root, 'build.gradle.kts');
  if (!raw) return;
  for (const m of raw.matchAll(/(?:implementation|api|compile|testImplementation)[\s(]+["']([^"':]+:[^"':]+)/g)) {
    add('dependency', m[1], `build.gradle: ${m[1]}`);
  }
}

function parseCsproj(root: string, add: Add): void {
  for (const file of shallowFind(root, (n) => n.endsWith('.csproj'), 2)) {
    const raw = readIf(root, file.slice(root.length + 1));
    if (!raw) continue;
    for (const m of raw.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
      add('dependency', m[1], `${file.slice(root.length + 1)}: ${m[1]}`);
    }
  }
}

const INFRA_FILES: Array<{ match: RegExp; tool: string }> = [
  { match: /^Dockerfile/, tool: 'Docker' },
  { match: /^docker-compose\.ya?ml$/, tool: 'Docker Compose' },
  { match: /^Makefile$/, tool: 'Make' },
  { match: /\.tf$/, tool: 'Terraform' },
  { match: /^(skaffold|helmfile)\.ya?ml$/, tool: 'Kubernetes' },
  { match: /^vercel\.json$/, tool: 'Vercel' },
  { match: /^netlify\.toml$/, tool: 'Netlify' },
  { match: /^serverless\.ya?ml$/, tool: 'Serverless Framework' },
];

function detectInfra(root: string, add: Add): void {
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return; }
  for (const name of entries) {
    for (const rule of INFRA_FILES) {
      if (rule.match.test(name)) add('tool', rule.tool, name);
    }
  }
  // CI providers
  if (existsSync(join(root, '.github', 'workflows'))) add('tool', 'GitHub Actions', '.github/workflows/');
  if (existsSync(join(root, '.gitlab-ci.yml'))) add('tool', 'GitLab CI', '.gitlab-ci.yml');
  if (existsSync(join(root, '.circleci'))) add('tool', 'CircleCI', '.circleci/');
  // Kubernetes manifests directory heuristic
  for (const d of ['k8s', 'kubernetes', 'deploy', 'charts']) {
    if (existsSync(join(root, d))) add('tool', 'Kubernetes', `${d}/`);
  }
}

/** Depth-limited filename search (avoids a full project walk). */
function shallowFind(root: string, pred: (name: string) => boolean, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.codegps') continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, depth + 1);
      else if (pred(name)) out.push(abs);
    }
  };
  walk(root, 0);
  return out;
}
