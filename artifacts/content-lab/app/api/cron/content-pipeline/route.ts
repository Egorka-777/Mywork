import { runContentPipeline } from "@/lib/content/pipeline";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await runContentPipeline();
  if (result.ok) {
    const { ok: _o, ...body } = result;
    return NextResponse.json({ ok: true, ...body });
  }
  return NextResponse.json(
    { ok: false, error: result.error },
    { status: 500 },
  );
}
