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

  const { token, userAgent } = req.body ?? {};
  if (!token) return json(res, 400, { error: "token is required" });

  const { data: collection, error: getErr } = await supabase
    .from("collections")
    .select("*")
    .eq("token", String(token))
    .maybeSingle();
  if (getErr) return json(res, 500, { error: getErr.message });
  if (!collection) return json(res, 404, { error: "Collection not found" });

  let nextViews = Number(collection.views_count ?? 0);
  if (Object.prototype.hasOwnProperty.call(collection, "views_count")) {
    nextViews += 1;
    const { error: updateErr } = await supabase
      .from("collections")
      .update({ views_count: nextViews })
      .eq("id", collection.id);
    if (updateErr) return json(res, 500, { error: updateErr.message });
  }

  // Таблица collection_views может отсутствовать в legacy-схеме.
  const { error: logErr } = await supabase.from("collection_views").insert({
    collection_id: collection.id,
    user_agent: userAgent ? String(userAgent) : null,
  });
  if (logErr && !/collection_views|schema cache|does not exist/i.test(String(logErr.message || ""))) {
    return json(res, 500, { error: logErr.message });
  }

  return json(res, 200, { views_count: nextViews });
}

