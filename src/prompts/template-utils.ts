const TEXT_PLACEHOLDER = /\{text\}/g;

/**
 * Replace every `{text}` placeholder in a template with the user's text.
 *
 * Uses a replacer function so `$&`, `$'`, `` $` `` and `$1` in the user's text
 * are inserted literally instead of being treated as replacement patterns.
 */
export function fillTextPlaceholder(template: string, text: string): string {
  return template.replace(TEXT_PLACEHOLDER, () => text);
}

/**
 * Build the final prompt for a custom prompt entry. If the instruction contains
 * `{text}`, it is used as a full template; otherwise the text is appended.
 */
export function buildCustomPrompt(instruction: string, text: string): string {
  if (instruction.includes('{text}')) {
    return fillTextPlaceholder(instruction, text);
  }
  return `${instruction.trim()}

Original text:
"${text}"

Provide ONLY the rewritten text, without explanations.

Rewritten text:`;
}

const RESPONSE_PREFIXES = ['Rewritten text:', 'Corrected text:', 'Optimized text:'];

/** Strip wrapping quotes and common "Rewritten text:" style prefixes from model output. */
export function cleanupModelResponse(result: string, removePrefixes: boolean): string {
  let cleaned = result.trim();

  if (removePrefixes) {
    for (const prefix of RESPONSE_PREFIXES) {
      if (cleaned.startsWith(prefix)) {
        cleaned = cleaned.slice(prefix.length).trim();
        break;
      }
    }
  }

  if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }

  return cleaned;
}
