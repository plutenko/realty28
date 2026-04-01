import { getSupabaseAdmin } from "../../../../lib/supabaseServer";

/**
 * Returns whether OAuth is connected (refresh_token stored). Does not expose tokens.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(200).json({ connected: false, reason: "no_supabase" });
    return;
  }

  const { data, error } = await supabase
    .from("google_sheets_oauth")
    .select("refresh_token")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("[google-sheets/status]", error);
    res.status(200).json({ connected: false, reason: "db" });
    return;
  }

  const connected = Boolean(String(data?.refresh_token || "").trim());
  res.status(200).json({ connected });
}
