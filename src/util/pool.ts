/**
 * Bounded-concurrency async map.
 *
 * Runs `fn` over `items` with at most `limit` promises in flight, preserving
 * result order. Used to parallelize independent LLM/agent calls in the
 * pipeline. DB writes stay safe because better-sqlite3 is synchronous — only
 * the network `await`s overlap; the sync persist steps never truly interleave.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  const width = Math.max(1, Math.min(limit, n));
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
