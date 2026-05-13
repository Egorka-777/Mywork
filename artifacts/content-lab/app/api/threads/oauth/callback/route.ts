import { NextResponse } from "next/server";

/**
 * Exchanges `code` for a short‑lived access token. Copy token into THREADS_ACCESS_TOKEN
 * in your host env. Exact Graph URL/params follow Meta’s current “Threads / Instagram Login” doc.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const err = searchParams.get("error");
  if (err) {
    return NextResponse.json({ ok: false, error: err }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "missing code" },
      { status: 400 },
    );
  }

  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const redirect = process.env.THREADS_OAUTH_REDIRECT_URI;
  if (!appId || !appSecret || !redirect) {
    return NextResponse.json(
      { ok: false, error: "Missing THREADS_APP_ID / SECRET / REDIRECT_URI" },
      { status: 500 },
    );
  }

  const tokenBase =
    process.env.THREADS_OAUTH_TOKEN_URL ??
    "https://graph.threads.com/oauth/access_token";
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirect,
    code,
  });

  const res = await fetch(tokenBase, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    access_token?: string;
    user_id?: string;
    error?: { message: string };
  };
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: "token exchange failed", raw: json },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    access_token: json.access_token,
    user_id: json.user_id,
    message:
      "Add access_token to THREADS_ACCESS_TOKEN and user id to THREADS_USER_ID in server env, then remove this from logs.",
  });
}
