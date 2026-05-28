export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Request JSON-only output (some backends support a strict mode). */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface EmbedRequest {
  model: string;
  texts: string[];
}

export interface EmbedResponse {
  vectors: number[][];
}

export interface Backend {
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed?(req: EmbedRequest): Promise<EmbedResponse>;
}
