// Pure helpers shared by the history backup route and (indirectly) the client
// backup logic. No Next.js or browser imports — kept dependency-free so the
// data-shaping rules are unit-testable in plain Node.

export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type HistoryChat = {
  id: string;
  title: string;
  createdAt: string;
  pinned?: boolean;
};

export type HistoryMeta = {
  chats: HistoryChat[];
  lastChatId?: string | null;
  updatedAt: string;
};

export function isValidClientId(clientId: string): boolean {
  return CLIENT_ID_PATTERN.test(clientId);
}

export const MAX_CHAT_JSON_BYTES = 350_000;

export function sanitizeMessages(messages: unknown[]): unknown[] {
  const trimmed = Array.isArray(messages) ? messages.slice(-300) : [];
  const sanitized = trimmed.map((m: any) => ({
    ...m,
    parts: Array.isArray(m?.parts)
      ? m.parts.map((part: any) =>
          part?.type === "file" && typeof part?.url === "string" && part.url.startsWith("data:")
            ? { ...part, url: "" }
            : part
        )
      : m?.parts,
  }));
  // KV values are size-limited; shrink the window until the payload fits.
  for (const limit of [300, 200, 100, 50]) {
    const candidate = sanitized.slice(-limit);
    if (JSON.stringify(candidate).length <= MAX_CHAT_JSON_BYTES) return candidate;
  }
  return [];
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

export function sanitizeChats(chats: unknown): HistoryChat[] {
  if (!Array.isArray(chats)) return [];
  return chats
    .filter(
      (c: any) =>
        c &&
        typeof c.id === "string" &&
        c.id.length > 0 &&
        c.id.length <= 200 &&
        typeof c.title === "string"
    )
    .slice(0, 200)
    .map((c: any) => ({
      id: c.id,
      title: c.title,
      createdAt: isValidIsoDate(c.createdAt) ? c.createdAt : new Date().toISOString(),
      pinned: Boolean(c.pinned),
    }));
}
