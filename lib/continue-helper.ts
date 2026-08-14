// Pure helpers for the in-place Continue flow. Kept dependency-free so they
// can be unit-tested in plain Node.

// Internal instruction sent when the user presses the rounded Continue button.
// It is hidden from the rendered conversation and removed from history once
// the continuation has been merged into the original reply, so the user never
// sees a "Continue" prompt bubble.
export const CONTINUE_INSTRUCTION =
  "Continue your previous response exactly where it stopped. Start with the very next word after the ending of your last response. Never repeat, re-type, or quote the text you already wrote — just keep writing from the cutoff point.";

// Appends the exact ending of the truncated reply so the model can anchor on
// where to resume WITHOUT re-typing that ending — re-typing the tail is the
// most common source of duplicated text after a Continue.
export function buildContinueInstruction(tail: string): string {
  const trimmed = tail.trimEnd();
  if (!trimmed) return CONTINUE_INSTRUCTION;
  const snippet = trimmed.length > 80 ? "…" + trimmed.slice(-80) : trimmed;
  return `${CONTINUE_INSTRUCTION}\n\nYour previous response ended with:\n"${snippet}"\n\nStart your reply right after that quoted ending — do not include the quoted text again.`;
}

export type ContinuationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  // Deliberately loose: real parts are UIMessagePart unions; the helper only
  // reads the text parts and preserves the rest verbatim.
  parts: any[];
};

// True for the internal user message used to trigger an in-place continuation.
export function isContinueInstruction(message: ContinuationMessage): boolean {
  return (
    message.role === "user" &&
    message.parts.some(
      (p) => p.type === "text" && typeof p.text === "string" && p.text.startsWith(CONTINUE_INSTRUCTION)
    )
  );
}

// Finds the active continuation triple in the message list:
// [source assistant reply] [invisible instruction] [streaming continuation].
// Returns undefined when there is no in-flight continuation.
export function findContinuation(messages: ContinuationMessage[]) {
  const idx = messages.findIndex(isContinueInstruction);
  if (idx === -1) return undefined;
  const source = messages[idx - 1];
  const instruction = messages[idx];
  const continuation = messages[idx + 1];
  if (!source || source.role !== "assistant") return undefined;
  if (!continuation || continuation.role !== "assistant") return undefined;
  return { source, instruction, continuation };
}

// Models asked to "keep writing" often re-anchor by re-typing the last words
// of the truncated reply ("They had" → "They had no idea"). Strip exactly one
// re-emitted copy from the start of the continuation so the seam reads once.
// The overlap must be a whole word/phrase (bounded by non-word characters or
// the string edges) so legitimate continuations are never damaged.
export function stripRepeatedPrefix(source: string, continuation: string): string {
  if (!source || !continuation) return continuation;

  const max = Math.min(source.length, continuation.length);
  for (let len = max; len >= 1; len--) {
    const overlap = continuation.slice(0, len);
    if (!source.endsWith(overlap)) continue;

    // The overlap must be a complete word/phrase on both sides: the character
    // before it in `source` and the character after it in `continuation` must
    // be whitespace (or the string edges). This rejects partial-word matches
    // ("the" + "theory…") and word-extension matches ("They had" + "They
    // hadn't…", where the anchor keeps going inside a contraction).
    const before = source[source.length - len - 1] ?? "";
    const after = continuation[len] ?? "";
    const boundary = (ch: string) => !ch || /\s/.test(ch);
    if (!boundary(before) || !boundary(after)) continue;

    // Remove one copy plus the whitespace that followed it, so the join sees
    // the continuation already positioned at the seam.
    return continuation.slice(len).replace(/^\s+/, "");
  }

  return continuation;
}

// Joins the truncated source text and the continuation text at their seam.
// A single space is inserted ONLY when both sides meet as words (the model
// stopped mid-sentence and resumed without a leading space). No space is
// added when either side already has whitespace, when the seam is a glue
// character (hyphen/slash), an opening delimiter, a decimal point, or between
// CJK characters — so "climbed to" + "second floor" becomes
// "climbed to second floor" while "well-" + "known" stays "well-known".
export function joinContinuedText(source: string, continuation: string): string {
  if (!continuation) return source;
  if (!source) return continuation;

  const start = continuation[0];
  // Continuation begins with whitespace → the model already handled spacing.
  if (/\s/.test(start)) return source + continuation;

  const end = source[source.length - 1];
  // Source ends with whitespace → join verbatim.
  if (/\s/.test(end)) return source + continuation;

  // Glue characters: hyphens, dashes, slashes — join verbatim.
  if (/[-–—/\\]/.test(end)) return source + continuation;

  // Decimal continuation: "3." + "14" → "3.14".
  if (end === "." && /\d/.test(start) && /\d/.test(source[source.length - 2] ?? "")) {
    return source + continuation;
  }

  // CJK scripts never take a space.
  if (/[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fff]/.test(end) && /[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fff]/.test(start)) {
    return source + continuation;
  }

  // Continuation begins with punctuation/formatting → join verbatim.
  if (!/\w/.test(start)) return source + continuation;

  // The significant character before any trailing formatting run (* ` ~).
  let sigIdx = source.length - 1;
  while (sigIdx > 0 && /[*`~]/.test(source[sigIdx])) sigIdx--;
  const sig = source[sigIdx];
  const before = source[sigIdx - 1] ?? "";

  // Closing delimiters and closing curly quotes: space before the next word.
  if (/[)\]}\u00bb\u201d]/.test(sig)) return source + " " + continuation;

  // Ambiguous straight quotes / apostrophes: decide from the preceding char.
  // Preceded by whitespace or an opener → the quote opens (e.g. `said "` +
  // `hello`); preceded by a word → it closes the previous word (`"hi"` +
  // `then`). A contraction suffix continues without a space (`doesn'` + `t`).
  if (sig === '"' || sig === "'" || sig === "\u2019") {
    const opens = sigIdx === 0 || /[\s([{\u00ab\u201c\u2018"'`*~>]/.test(before);
    if (opens) return source + continuation;
    const firstWord = continuation.match(/^\w+/)?.[0] ?? "";
    if (/^(t|s|re|ve|ll|d|m|em|cause)$/.test(firstWord)) return source + continuation;
    return source + " " + continuation;
  }

  // Opening delimiters and opening quotes: no space after them.
  if (/[([{\u00ab\u201c\u2018]/.test(sig)) return source + continuation;

  // Word boundary: previous side ends in a word/punctuation and the
  // continuation starts a word → exactly one space.
  return source + " " + continuation;
}

// Merges a streamed continuation assistant message into its truncated source
// message so the UI shows one continuously growing bubble.
export function mergeAssistantText(
  source: ContinuationMessage,
  continuation: ContinuationMessage
): ContinuationMessage {
  const contText = (continuation?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  const sourceTextParts = (source?.parts ?? []).filter((p) => p.type === "text");
  if (sourceTextParts.length === 0) {
    return { ...source, parts: [...(source?.parts ?? []), ...(continuation?.parts ?? [])] };
  }
  const lastTextIdx =
    source.parts.length - 1 - [...source.parts].reverse().findIndex((p) => p.type === "text");
  const newParts = source.parts.map((p, idx) =>
    idx === lastTextIdx && p.type === "text"
      ? { ...p, text: joinContinuedText(p.text ?? "", stripRepeatedPrefix(p.text ?? "", contText)) }
      : p
  );
  const contNonText = (continuation?.parts ?? []).filter((p) => p.type !== "text");
  return { ...source, parts: [...newParts, ...contNonText] };
}

