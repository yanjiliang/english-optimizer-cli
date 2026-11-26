import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { readOllamaNDJSONStream, readOpenAISSEStream } from './stream-utils';

describe('stream-utils', () => {
  describe('readOpenAISSEStream', () => {
    it('parses chunked SSE lines including split multi-byte UTF-8 characters', async () => {
      const payload = Buffer.from(
        [
          ': keep-alive',
          'data: {"choices":[{"delta":{"content":"Hi "}}]}',
          'data:{"choices":[{"delta":{"content":"你好🚀"}}]}',
          'data: [DONE]',
          '',
        ].join('\n'),
        'utf-8'
      );

      // Slice in odd byte sizes to deliberately split multi-byte UTF-8 sequences across chunks
      const chunks: Buffer[] = [];
      for (let i = 0; i < payload.length; i += 7) {
        chunks.push(payload.subarray(i, i + 7));
      }

      const tokens: string[] = [];
      const result = await readOpenAISSEStream(Readable.from(chunks), (t) => tokens.push(t));

      expect(tokens).toEqual(['Hi ', '你好🚀']);
      expect(result).toBe('Hi 你好🚀');
    });

    it('falls back cleanly when a proxy returns plain JSON instead of SSE', async () => {
      const jsonBody = JSON.stringify({
        choices: [{ message: { content: 'Plain JSON response' } }],
      });
      const tokens: string[] = [];
      const result = await readOpenAISSEStream(Readable.from([jsonBody]), (t) => tokens.push(t));

      expect(tokens).toEqual(['Plain JSON response']);
      expect(result).toBe('Plain JSON response');
    });

    it('throws when an SSE payload contains an error object', async () => {
      const stream = Readable.from(['data: {"error":{"message":"Quota exceeded"}}\n\n']);
      await expect(readOpenAISSEStream(stream)).rejects.toThrow('Quota exceeded');
    });
  });

  describe('readOllamaNDJSONStream', () => {
    it('parses partial NDJSON chunks and emits tokens', async () => {
      const stream = Readable.from([
        '{"response":"Take a ',
        'look","done":false}\n{"response":" please.","done":false}\n{"done":true}',
      ]);
      const tokens: string[] = [];
      const result = await readOllamaNDJSONStream(stream, (t) => tokens.push(t));

      expect(tokens).toEqual(['Take a look', ' please.']);
      expect(result).toBe('Take a look please.');
    });

    it('throws when Ollama streams an error line', async () => {
      const stream = Readable.from(['{"error":"model not found"}\n']);
      await expect(readOllamaNDJSONStream(stream)).rejects.toThrow('model not found');
    });
  });
});
