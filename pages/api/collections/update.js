import { getSupabaseAdmin } from "../../../lib/supabaseServer";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(res, 500, { error: "Supabase server key is not configured" });
  }

  const {
    id,
    title,
    clientName,
    showComplexName,
    showDeveloperName,
    showAddress,
  } = req.body ?? {};

  if (!id) return json(res, 400, { error: "id is required" });

  const patch = {};
  if (typeof title === "string") {
    const t = title.trim();
    if (!t) return json(res, 400, { error: "title не может быть пустым" });
    patch.title = t;
  }
  if (clientName !== undefined) {
    patch.client_name = clientName ? String(clientName) : null;
  }
  if (typeof showComplexName === "boolean") patch.show_complex_name = showComplexName;
  if (typeof showDeveloperName === "boolean") patch.show_developer_name = showDeveloperName;
  if (typeof showAddress === "boolean") patch.show_address = showAddress;

  if (Object.keys(patch).length === 0) {
    return json(res, 400, { error: "нечего обновлять" });
  }

  const { data, error } = await supabase
    .from("collections")
    .update(patch)
    .eq("id", String(id))
    .select("id, token, title, client_name, show_complex_name, show_developer_name, show_address")
    .single();

  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { collection: data });
}
