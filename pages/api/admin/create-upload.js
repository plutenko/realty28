import crypto from "crypto";
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

  const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || "realty-media";
  const { kind, entityId, filename } = req.body ?? {};

  const safeKind = ["project_hero", "unit_layout", "unit_finish"].includes(kind)
    ? kind
    : null;
  if (!safeKind) return json(res, 400, { error: "Invalid kind" });
  if (!entityId) return json(res, 400, { error: "entityId is required" });
  if (!filename) return json(res, 400, { error: "filename is required" });

  const ext = String(filename).split(".").pop()?.toLowerCase() || "bin";
  const id = String(entityId);
  const random = crypto.randomBytes(8).toString("hex");
  const path = `${safeKind}/${id}/${Date.now()}-${random}.${ext}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) return json(res, 500, { error: error.message });

  // Bucket должен быть public, чтобы покупатель видел картинки по URL
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);

  return json(res, 200, {
    bucket,
    path,
    token: data?.token,
    signedUrl: data?.signedUrl,
    publicUrl: pub?.publicUrl ?? null,
  });
}

