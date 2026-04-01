import crypto from "crypto";
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

  const { unitIds, selectedUnits, title, clientName } = req.body ?? {};
  const rawIds = Array.isArray(selectedUnits) ? selectedUnits : unitIds;
  const ids = Array.isArray(rawIds) ? rawIds.map((x) => String(x)).filter(Boolean) : [];

  if (ids.length === 0) return json(res, 400, { error: "unitIds is required" });

  const token = crypto.randomBytes(6).toString("hex");

  const basePayload = {
    token,
    title: title ? String(title) : null,
  };
  const modernPayload = {
    ...basePayload,
    client_name: clientName ? String(clientName) : null,
    units: ids,
  };

  let collection = null;
  let cErr = null;

  {
    const resModern = await supabase
      .from("collections")
      .insert(modernPayload)
      .select("*")
      .single();
    collection = resModern.data;
    cErr = resModern.error;
  }

  // Совместимость со старой схемой (без client_name/units в collections).
  if (cErr && /client_name|units|schema cache|column/i.test(String(cErr.message || ""))) {
    const resLegacy = await supabase
      .from("collections")
      .insert(basePayload)
      .select("*")
      .single();
    if (resLegacy.error) return json(res, 500, { error: resLegacy.error.message });
    collection = resLegacy.data;

    const rows = ids.map((unit_id, idx) => ({
      collection_id: collection.id,
      unit_id,
      sort_order: idx,
    }));
    const { error: mapErr } = await supabase.from("collection_units").insert(rows);
    if (mapErr) return json(res, 500, { error: mapErr.message });
  } else if (cErr) {
    return json(res, 500, { error: cErr.message });
  }

  return json(res, 200, { token: collection.token, id: collection.id });
}

