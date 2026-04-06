import { getSupabaseAdmin } from "../../../lib/supabaseServer";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function uniqueUnitIdsPreserveOrder(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const UNITS_SELECT = `
  *,
  building:building_id (
    id,
    name,
    complex:complex_id (
      id,
      name,
      realtor_commission_type,
      realtor_commission_value,
      developer:developer_id (
        id,
        name,
        developer_managers (
          id,
          name,
          phone,
          short_description,
          messenger,
          created_at
        )
      )
    )
  )
`;

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(res, 500, {
      error:
        "Supabase server key is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart dev server.",
    });
  }

  const token = req.query?.token ? String(req.query.token) : "";
  if (!token) return json(res, 400, { error: "token is required" });

  const { data: c, error: cErr } = await supabase
    .from("collections")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (cErr) return json(res, 500, { error: cErr.message });
  if (!c) return json(res, 404, { error: "Collection not found" });

  let rawIds = Array.isArray(c.units) ? c.units : [];

  if (rawIds.length === 0) {
    const { data: mapRows, error: mapErr } = await supabase
      .from("collection_units")
      .select("unit_id, sort_order")
      .eq("collection_id", c.id)
      .order("sort_order", { ascending: true });

    if (!mapErr && Array.isArray(mapRows)) {
      rawIds = mapRows.map((r) => r.unit_id).filter(Boolean);
    }
  }

  const unitIds = uniqueUnitIdsPreserveOrder(rawIds);

  let rows = [];
  if (unitIds.length > 0) {
    const { data: unitsData, error: uErr } = await supabase
      .from("units")
      .select(UNITS_SELECT)
      .in("id", unitIds);

    if (uErr) return json(res, 500, { error: uErr.message });
    rows = unitsData ?? [];
  }

  const byId = new Map((rows ?? []).map((u) => [String(u.id), u]));
  const orderedUnits = unitIds.map((id) => byId.get(String(id))).filter(Boolean);

  let realtorName = null;
  if (c.created_by) {
    const { data: p } = await supabase
      .from("profiles")
      .select("name, email")
      .eq("id", c.created_by)
      .maybeSingle();
    if (p) realtorName = p.name || p.email || null;
  }

  res.setHeader("Cache-Control", "no-store");
  return json(res, 200, {
    collection: c,
    units: orderedUnits,
    missingCount: unitIds.length - orderedUnits.length,
    realtorName,
  });
}
