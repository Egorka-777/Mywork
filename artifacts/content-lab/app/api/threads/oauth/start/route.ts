import { NextResponse } from "next/server";

/**
 * Start Threads OAuth. Meta/Threads URLs may change — override with THREADS_OAUTH_AUTHORIZE_BASE.
 * App must be configured with a valid redirect URI.
 */
export async function GET() {
  const appId = process.env.THREADS_APP_ID;
  const redirect = process.env.THREADS_OAUTH_REDIRECT_URI;
  if (!appId || !redirect) {
    return NextResponse.json(
      {
        error:
          "Set THREADS_APP_ID and THREADS_OAUTH_REDIRECT_URI (e.g. https://yoursite/api/threads/oauth/callback).",
      },
      { status: 500 },
    );
  }

  const base =
    process.env.THREADS_OAUTH_AUTHORIZE_BASE ??
    "https://www.threads.net/oauth/authorize";
  const scope =
    process.env.THREADS_OAUTH_SCOPES ??
    "threads_basic,threads_content_publish,threads_keyword_search,threads_read_public";
  const u = new URL(base);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", process.env.CRON_SECRET ?? "state");
  return NextResponse.redirect(u.toString());
}
