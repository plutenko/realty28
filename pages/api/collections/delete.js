import { getSupabaseAdmin } from "../../../lib/supabaseServer";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(res, 500, {
      error:
        "Supabase server key is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart dev server.",
    });
  }

  const { id } = req.body ?? {};
  if (!id) return json(res, 400, { error: "id is required" });

  const { error } = await supabase.from("collections").delete().eq("id", String(id));
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { ok: true });
}
