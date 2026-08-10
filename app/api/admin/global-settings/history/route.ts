import { NextResponse } from "next/server";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ModelMap = Record<string, string>;

type GlobalSettings = {
  BLOCKRUN_API_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY?: string;
  BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
  useFallbackAsPrimary?: boolean;
  PRIMARY_MODELS?: ModelMap;
  FALLBACK_MODELS?: ModelMap;
};

export type GlobalSettingsHistoryEntry = {
  id: string;
  timestamp: string;
  label: string;
  changedBy: string;
  before: GlobalSettings;
  after: GlobalSettings;
  changes: Record<string, { before: any; after: any }>;
};

async function readSettingsHistory(): Promise<GlobalSettingsHistoryEntry[]> {
  try {
    return await readData<GlobalSettingsHistoryEntry[]>(STORAGE_KEYS.GLOBAL_SETTINGS_HISTORY, []);
  } catch (err) {
    console.error("readSettingsHistory error:", err);
    return [];
  }
}

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const history = await readSettingsHistory();
  return NextResponse.json(
    { history },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
