/**
 * web-tree-sitter parser setup. Languages are loaded lazily and cached.
 */
import { Parser, Language } from 'web-tree-sitter';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let initialized = false;
const langCache = new Map<string, Language>();

function climbForNodeModule(subpath: string): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'node_modules', subpath);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate node_modules/${subpath}`);
}

function wasmDir(): string {
  return climbForNodeModule('tree-sitter-wasms/out');
}

function treeSitterCoreWasm(): string {
  return climbForNodeModule('web-tree-sitter/tree-sitter.wasm');
}

export async function initParser(): Promise<void> {
  if (initialized) return;
  const coreWasm = treeSitterCoreWasm();
  const coreBuf = readFileSync(coreWasm);
  await Parser.init({
    locateFile: () => coreWasm,
    wasmBinary: new Uint8Array(coreBuf),
  } as any);
  initialized = true;
}

export async function loadLanguage(wasmFile: string): Promise<Language> {
  const cached = langCache.get(wasmFile);
  if (cached) return cached;
  await initParser();
  const path = join(wasmDir(), wasmFile);
  const buf = readFileSync(path);
  const lang = await Language.load(new Uint8Array(buf));
  langCache.set(wasmFile, lang);
  return lang;
}

export async function parseSource(wasmFile: string, source: string) {
  const language = await loadLanguage(wasmFile);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  parser.delete();
  return tree;
}
