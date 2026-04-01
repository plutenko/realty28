import { getSupabaseAdmin } from "../../../lib/supabaseServer";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function requireAdmin(req) {
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected) return { ok: false, error: "ADMIN_UPLOAD_TOKEN is not set" };
  const got = req.headers["x-admin-token"];
  if (!got || String(got) !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(res, 500, {
      error:
        "Supabase server key is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart dev server.",
    });
  }

  const { kind, entityId, publicUrl } = req.body ?? {};
  if (!entityId) return json(res, 400, { error: "entityId is required" });
  if (!publicUrl) return json(res, 400, { error: "publicUrl is required" });

  if (kind === "project_hero") {
    const { error } = await supabase
      .from("projects")
      .update({ hero_image_url: String(publicUrl) })
      .eq("id", String(entityId));
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  if (kind === "unit_layout") {
    const { error } = await supabase
      .from("units")
      .update({ layout_image_url: String(publicUrl) })
      .eq("id", String(entityId));
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  if (kind === "unit_finish") {
    const { error } = await supabase
      .from("units")
      .update({ finish_image_url: String(publicUrl) })
      .eq("id", String(entityId));
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Invalid kind" });
}

