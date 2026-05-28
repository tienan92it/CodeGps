import type { Backend, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse } from './base.js';

interface OpenAIOpts {
  endpoint: string;
  apiKey?: string;
}

/** OpenAI-compatible backend (works with OpenAI, Together, Groq, etc). */
export class OpenAIBackend implements Backend {
  constructor(private opts: OpenAIOpts) {
    if (!opts.apiKey) {
      throw new Error('OpenAI backend requires apiKey (set apiKeyEnv in config)');
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: any = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.opts.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    return {
      content: data?.choices?.[0]?.message?.content ?? '',
      tokensIn: data?.usage?.prompt_tokens,
      tokensOut: data?.usage?.completion_tokens,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const res = await fetch(`${this.opts.endpoint}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: req.model, input: req.texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embed ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    const vectors: number[][] = (data?.data ?? []).map((d: any) => d.embedding);
    return { vectors };
  }
}
