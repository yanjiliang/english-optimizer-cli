import { StringDecoder } from 'string_decoder';

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    message?: { content?: string | null };
  }>;
  error?: {
    code?: string | number;
    message?: string;
  };
}

interface OllamaStreamChunk {
  response?: string;
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

/** Collect an async stream of UTF-8 chunks into a single string. */
export async function readStreamAsString(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const decoder = new StringDecoder('utf8');
  let output = '';

  for await (const chunk of stream) {
    output += typeof chunk === 'string' ? chunk : decoder.write(chunk);
  }
  output += decoder.end();

  return output;
}

/**
 * Parse an OpenAI-compatible Server-Sent Events (SSE) stream and emit delta tokens.
 * Also handles servers that ignore `stream: true` and return a single JSON object.
 */
export async function readOpenAISSEStream(
  stream: AsyncIterable<Buffer | string>,
  onToken?: (token: string) => void
): Promise<string> {
  const decoder = new StringDecoder('utf8');
  let lineBuffer = '';
  let fullText = '';
  let rawOutput = '';
  let sawDataLine = false;

  const processLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith(':')) {
      return;
    }
    if (!line.startsWith('data:')) {
      return;
    }

    sawDataLine = true;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      return;
    }

    let parsed: OpenAIStreamChunk;
    try {
      parsed = JSON.parse(payload) as OpenAIStreamChunk;
    } catch {
      // Ignore partial or non-JSON control payloads
      return;
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
    if (typeof token === 'string' && token.length > 0) {
      fullText += token;
      onToken?.(token);
    }
  };

  for await (const chunk of stream) {
    const decoded = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    if (!sawDataLine) {
      rawOutput += decoded;
    }
    lineBuffer += decoded;

    let newlineIndex = lineBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      processLine(lineBuffer.slice(0, newlineIndex));
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      newlineIndex = lineBuffer.indexOf('\n');
    }
  }

  const tail = decoder.end();
  if (tail) {
    if (!sawDataLine) {
      rawOutput += tail;
    }
    lineBuffer += tail;
  }
  if (lineBuffer.trim()) {
    processLine(lineBuffer);
  }

  // Fallback for proxies that return plain JSON even when stream: true was sent
  if (!sawDataLine && rawOutput.trim()) {
    try {
      const parsed = JSON.parse(rawOutput) as OpenAIStreamChunk;
      if (parsed.error?.message) {
        throw new Error(parsed.error.message);
      }
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        onToken?.(content);
        return content.trim();
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid response from API');
      }
      throw error;
    }
  }

  return fullText.trim();
}

/** Parse an Ollama NDJSON stream from `/api/generate` and emit response tokens. */
export async function readOllamaNDJSONStream(
  stream: AsyncIterable<Buffer | string>,
  onToken?: (token: string) => void
): Promise<string> {
  const decoder = new StringDecoder('utf8');
  let lineBuffer = '';
  let fullText = '';

  const processLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) {
      return;
    }

    let parsed: OllamaStreamChunk;
    try {
      parsed = JSON.parse(line) as OllamaStreamChunk;
    } catch {
      return;
    }

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    const token =
      typeof parsed.message?.content === 'string' ? parsed.message.content : parsed.response;
    if (typeof token === 'string' && token.length > 0) {
      fullText += token;
      onToken?.(token);
    }
  };

  for await (const chunk of stream) {
    const decoded = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    lineBuffer += decoded;

    let newlineIndex = lineBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      processLine(lineBuffer.slice(0, newlineIndex));
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      newlineIndex = lineBuffer.indexOf('\n');
    }
  }

  const tail = decoder.end();
  if (tail) {
    lineBuffer += tail;
  }
  if (lineBuffer.trim()) {
    processLine(lineBuffer);
  }

  return fullText.trim();
}
