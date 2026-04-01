import { getSupabaseAdmin } from "../../../lib/supabaseServer";

/**
 * Единый источник контактов застройщика: таблица `developer_managers`.
 * Маршрут сохранён для обратной совместимости; поле `note` в ответах = `short_description`.
 */

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

/** Нормализация для API: legacy `note` дублирует short_description */
function toApiRow(row) {
  if (!row) return row;
  const short = row.short_description ?? null;
  return {
    id: row.id,
    developer_id: row.developer_id,
    name: row.name,
    phone: row.phone,
    short_description: short,
    messenger: row.messenger ?? "telegram",
    note: short,
    created_at: row.created_at,
  };
}

function parseShortDescription(body) {
  if (body.short_description != null) return String(body.short_description);
  if (body.shortDescription != null) return String(body.shortDescription);
  if (body.note != null) return String(body.note);
  return null;
}

export default async function handler(req, res) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, 401, { error: auth.error });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(res, 500, {
      error:
        "Supabase server key is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart dev server.",
    });
  }

  if (req.method === "GET") {
    const developerId = req.query?.developerId ? String(req.query.developerId) : "";
    if (!developerId) return json(res, 400, { error: "developerId is required" });

    const { data, error } = await supabase
      .from("developer_managers")
      .select("id, developer_id, name, phone, short_description, messenger, created_at")
      .eq("developer_id", developerId)
      .order("created_at", { ascending: true });

    if (error) return json(res, 500, { error: error.message });
    const contacts = (data ?? []).map(toApiRow);
    return json(res, 200, { contacts, managers: contacts });
  }

  if (req.method === "POST") {
    const body = req.body ?? {};
    const { developerId, name, phone, messenger } = body;
    if (!developerId) return json(res, 400, { error: "developerId is required" });
    if (!name) return json(res, 400, { error: "name is required" });

    const shortRaw = parseShortDescription(body);
    const short = shortRaw && String(shortRaw).trim() ? String(shortRaw).trim() : null;
    const msg = messenger && ["whatsapp", "telegram", "max"].includes(String(messenger))
      ? String(messenger)
      : "telegram";

    const { data, error } = await supabase
      .from("developer_managers")
      .insert({
        developer_id: String(developerId),
        name: String(name),
        phone: phone ? String(phone) : null,
        short_description: short,
        messenger: msg,
      })
      .select("id, developer_id, name, phone, short_description, messenger, created_at")
      .single();

    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, toApiRow(data));
  }

  if (req.method === "PATCH") {
    const { id, name, phone, messenger } = req.body ?? {};
    if (!id) return json(res, 400, { error: "id is required" });

    const patch = {};
    if (name !== undefined) patch.name = name ? String(name) : "";
    if (phone !== undefined) patch.phone = phone ? String(phone) : null;
    if (req.body && "short_description" in req.body) {
      const s = req.body.short_description;
      patch.short_description = s != null && String(s).trim() ? String(s).trim() : null;
    } else if (req.body && "shortDescription" in req.body) {
      const s = req.body.shortDescription;
      patch.short_description = s != null && String(s).trim() ? String(s).trim() : null;
    } else if (req.body && "note" in req.body) {
      const s = req.body.note;
      patch.short_description = s != null && String(s).trim() ? String(s).trim() : null;
    }
    if (messenger !== undefined) {
      const m = String(messenger);
      patch.messenger = ["whatsapp", "telegram", "max"].includes(m) ? m : "telegram";
    }

    if (Object.keys(patch).length === 0) {
      return json(res, 400, { error: "No fields to update" });
    }

    const { data, error } = await supabase
      .from("developer_managers")
      .update(patch)
      .eq("id", String(id))
      .select("id, developer_id, name, phone, short_description, messenger, created_at")
      .single();

    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, toApiRow(data));
  }

  if (req.method === "DELETE") {
    const { id } = req.body ?? {};
    if (!id) return json(res, 400, { error: "id is required" });

    const { error } = await supabase.from("developer_managers").delete().eq("id", String(id));

    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "Method not allowed" });
}
