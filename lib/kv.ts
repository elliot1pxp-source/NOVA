import { kv } from '@vercel/kv';

export type GlobalConfig = {
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  DEEPTHINK_TOKEN?: string;
  SERPER_API_KEY?: string;
};

export type PaidCodeEntry = {
  expiry: string;
  tokens: GlobalConfig;
};

const GLOBAL_CONFIG_KEY = 'global_config';
const PAID_CODES_KEY = 'paid_codes';

export async function getGlobalConfig(): Promise<GlobalConfig | null> {
  return (await kv.get<GlobalConfig>(GLOBAL_CONFIG_KEY)) ?? null;
}

export async function setGlobalConfig(config: GlobalConfig): Promise<void> {
  await kv.set(GLOBAL_CONFIG_KEY, config);
}

export async function getPaidCodes(): Promise<Record<string, PaidCodeEntry>> {
  return (await kv.get<Record<string, PaidCodeEntry>>(PAID_CODES_KEY)) ?? {};
}

export async function setPaidCodes(codes: Record<string, PaidCodeEntry>): Promise<void> {
  await kv.set(PAID_CODES_KEY, codes);
}

export async function getPaidCode(code: string): Promise<PaidCodeEntry | null> {
  const codes = await getPaidCodes();
  return codes[code] ?? null;
}

export async function addPaidCode(code: string, entry: PaidCodeEntry): Promise<void> {
  const codes = await getPaidCodes();
  codes[code] = entry;
  await setPaidCodes(codes);
}

export async function deletePaidCode(code: string): Promise<void> {
  const codes = await getPaidCodes();
  delete codes[code];
  await setPaidCodes(codes);
}
