import type { Backend, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse } from './base.js';

interface OllamaOpts {
  endpoint: string;
}

/** Ollama HTTP backend. https://github.com/ollama/ollama/blob/main/docs/api.md */
export class OllamaBackend implements Backend {
  constructor(private opts: OllamaOpts) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: req.model,
      messages: req.messages,
      stream: false,
      format: req.jsonMode ? 'json' : undefined,
      options: {
        temperature: req.temperature ?? 0.2,
        num_predict: req.maxTokens,
      },
    };
    const res = await fetch(`${this.opts.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    return {
      content: data?.message?.content ?? '',
      tokensIn: data?.prompt_eval_count,
      tokensOut: data?.eval_count,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const vectors: number[][] = [];
    // /api/embed supports batch as of recent versions; fall back to per-text if needed.
    for (const text of req.texts) {
      const res = await fetch(`${this.opts.endpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: req.model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embed ${res.status}: ${await res.text()}`);
      }
      const data: any = await res.json();
      vectors.push(data?.embedding ?? []);
    }
    return { vectors };
  }
}
