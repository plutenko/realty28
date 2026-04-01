import { OAuth2Client } from "google-auth-library";
import { getSupabaseAdmin } from "../../../../lib/supabaseServer";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const q = req.query || {};
  if (q.error) {
    res.redirect(302, `/admin/sources?google_oauth=denied`);
    return;
  }

  const rawCode = q.code;
  const code =
    typeof rawCode === "string"
      ? rawCode
      : Array.isArray(rawCode)
        ? String(rawCode[0] || "")
        : "";
  if (!code) {
    res.redirect(302, `/admin/sources?google_oauth=no_code`);
    return;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.redirect(302, `/admin/sources?google_oauth=config`);
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.redirect(302, `/admin/sources?google_oauth=no_supabase`);
    return;
  }

  try {
    const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    const { data: existing } = await supabase
      .from("google_sheets_oauth")
      .select("refresh_token")
      .eq("id", 1)
      .maybeSingle();

    const refreshToken =
      tokens.refresh_token ||
      (typeof existing?.refresh_token === "string" ? existing.refresh_token : null);

    if (!refreshToken || !String(refreshToken).trim()) {
      console.error(
        "[google-sheets/callback] Google не вернул refresh_token. Откройте https://myaccount.google.com/permissions — удалите доступ к этому приложению и подключите снова (нужен первый вход с согласием)."
      );
      res.redirect(302, `/admin/sources?google_oauth=no_refresh`);
      return;
    }

    const expiryIso =
      tokens.expiry_date != null
        ? new Date(tokens.expiry_date).toISOString()
        : null;

    const { error: upsertErr } = await supabase.from("google_sheets_oauth").upsert(
      {
        id: 1,
        access_token: tokens.access_token ?? null,
        refresh_token: refreshToken,
        token_expiry: expiryIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (upsertErr) {
      console.error("[google-sheets/callback] upsert:", upsertErr);
      res.redirect(302, `/admin/sources?google_oauth=db`);
      return;
    }

    res.redirect(302, `/admin/sources?google_oauth=ok`);
  } catch (e) {
    const ex = e && typeof e === "object" ? e : {};
    const resData =
      "response" in ex && ex.response && typeof ex.response === "object" && "data" in ex.response
        ? ex.response.data
        : null;
    const dataStr =
      resData && typeof resData === "object"
        ? JSON.stringify(resData)
        : typeof resData === "string"
          ? resData
          : "";
    const msg =
      "message" in ex && typeof ex.message === "string" ? ex.message : String(e);
    const detail = `${msg} ${dataStr}`.trim();
    console.error("[google-sheets/callback] getToken / OAuth error:", detail);
    const hint = /redirect_uri|Redirect URI mismatch/i.test(detail)
      ? "redirect_mismatch"
      : /invalid_grant/i.test(detail)
        ? "invalid_grant"
        : "token";
    res.redirect(302, `/admin/sources?google_oauth=${hint}`);
  }
}
