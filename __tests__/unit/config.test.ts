import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, parseModelRef } from '../../src/config';

describe('config', () => {
  it('default config has triage agent', () => {
    expect(DEFAULT_CONFIG.agents.triage).toBeDefined();
    expect(DEFAULT_CONFIG.agents.triage.model.startsWith('default:')).toBe(true);
  });

  it('parseModelRef splits on first colon, preserving model name with colons', () => {
    expect(parseModelRef('default:llama3.1:8b')).toEqual({ backend: 'default', model: 'llama3.1:8b' });
  });

  it('parseModelRef rejects bare model name', () => {
    expect(() => parseModelRef('llama3.1')).toThrow();
  });
});
