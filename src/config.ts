import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export type BackendKind = 'ollama' | 'openai-compatible' | 'anthropic';

export interface AgentBackend {
  kind: BackendKind;
  endpoint?: string;
  apiKeyEnv?: string;
}

export interface AgentSpec {
  /** model ref of the form "<backend>:<model>" e.g. "default:llama3.1:8b" */
  model: string;
  fallback?: string;
  windowTokens?: number;
}

export interface CodeGpsConfig {
  agentBackends: Record<string, AgentBackend>;
  agents: Record<string, AgentSpec>;
  /** Paths for cross-agent transcript discovery; resolved with ~ expansion. */
  transcriptRoots?: {
    cursor?: string;
    claudeCode?: string;
    codex?: string;
    copilot?: string;
  };
}

export const DEFAULT_CONFIG: CodeGpsConfig = {
  agentBackends: {
    default: { kind: 'ollama', endpoint: 'http://localhost:11434' },
  },
  agents: {
    triage:         { model: 'default:llama3.1:8b', windowTokens: 2000 },
    dedupe:         { model: 'default:nomic-embed-text' },
    decision:       { model: 'default:llama3.1:8b' },
    businessLogic:  { model: 'default:llama3.1:8b' },
    intent:         { model: 'default:llama3.1:8b' },
    problemSolution:{ model: 'default:llama3.1:8b' },
    clusterer:      { model: 'default:llama3.1:8b' },
    summarizer:     { model: 'default:llama3.1:8b' },
    linker:         { model: 'default:llama3.1:8b' },
    verifier:       { model: 'default:llama3.1:8b' },
  },
  transcriptRoots: {
    cursor: '~/.cursor/projects',
    claudeCode: '~/.claude/projects',
    codex: '~/.codex/sessions',
  },
};

export function expandHome(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export function globalConfigDir(): string {
  return join(homedir(), '.codegps');
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), 'config.json');
}

export function projectConfigDir(projectRoot: string): string {
  return join(resolve(projectRoot), '.codegps');
}

export function projectConfigPath(projectRoot: string): string {
  return join(projectConfigDir(projectRoot), 'config.json');
}

/**
 * Load merged config (global + per-project override). Returns DEFAULT_CONFIG
 * if neither file exists. Per-project keys deep-merge over global keys.
 */
export function loadConfig(projectRoot?: string): CodeGpsConfig {
  const merged: CodeGpsConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const gp = globalConfigPath();
  if (existsSync(gp)) deepMerge(merged, readJson(gp));
  if (projectRoot) {
    const pp = projectConfigPath(projectRoot);
    if (existsSync(pp)) deepMerge(merged, readJson(pp));
  }
  return merged;
}

export function ensureGlobalConfig(): string {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = globalConfigPath();
  if (!existsSync(p)) writeFileSync(p, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return p;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function deepMerge(target: any, source: any): void {
  if (!source || typeof source !== 'object') return;
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
}

/** Parse "<backend>:<model>" into {backend, model}. */
export function parseModelRef(ref: string): { backend: string; model: string } {
  const idx = ref.indexOf(':');
  if (idx < 0) throw new Error(`Invalid model ref: ${ref} (expected "<backend>:<model>")`);
  return { backend: ref.slice(0, idx), model: ref.slice(idx + 1) };
}
