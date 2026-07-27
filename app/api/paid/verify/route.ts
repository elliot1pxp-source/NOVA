import { getPaidCode } from '@/lib/kv';

export async function POST(req: Request) {
  const { code } = await req.json();
  if (!code) return NextResponse.json({ valid: false }, { status: 400 });

  const entry = await getPaidCode(code);
  if (!entry) return NextResponse.json({ valid: false });

  const now = Date.now();
  if (new Date(entry.expiry).getTime() < now) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({ valid: true, expiry: entry.expiry });
}
