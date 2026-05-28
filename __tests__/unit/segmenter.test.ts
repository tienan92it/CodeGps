import { describe, it, expect } from 'vitest';
import { segmentTurnsToWindows } from '../../src/pipeline/segmenter';
import type { Turn } from '../../src/types';

function t(idx: number, role: Turn['role'], text: string): Turn {
  return { id: `s-${idx}`, sessionId: 's', idx, role, text };
}

describe('window segmenter', () => {
  it('starts a new window at each user turn', () => {
    const turns: Turn[] = [
      t(0, 'user', 'first'),
      t(1, 'assistant', 'first reply'),
      t(2, 'user', 'second'),
      t(3, 'assistant', 'second reply'),
    ];
    const ws = segmentTurnsToWindows('s', turns);
    expect(ws).toHaveLength(2);
    expect(ws[0].turns.map((t) => t.idx)).toEqual([0, 1]);
    expect(ws[1].turns.map((t) => t.idx)).toEqual([2, 3]);
  });

  it('drops windows without both user and response', () => {
    const turns: Turn[] = [
      t(0, 'user', 'only a question'),
    ];
    const ws = segmentTurnsToWindows('s', turns);
    expect(ws).toHaveLength(0);
  });

  it('hashes are stable for the same content', () => {
    const turns: Turn[] = [
      t(0, 'user', 'q'),
      t(1, 'assistant', 'a'),
    ];
    const a = segmentTurnsToWindows('s', turns);
    const b = segmentTurnsToWindows('s', turns);
    expect(a[0].textHash).toBe(b[0].textHash);
    expect(a[0].id).toBe(b[0].id);
  });
});
