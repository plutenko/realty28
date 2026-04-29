import { syncAllSources, syncSource } from "../../lib/syncSources";
import {
  syncGoogleSheetsFromSource,
  shouldUseGoogleSheetsChessboardSync,
} from "./sync-google-sheets";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    const skipImages =
      String(req.query?.skipImages ?? '').trim() === '1' ||
      String(req.query?.skipImages ?? '').toLowerCase() === 'true';
    const sourceId = req.query?.id ? String(req.query.id) : "";
    if (sourceId) {
      const supabaseModule = await import("../../lib/supabaseServer");
      const supabase = supabaseModule.getSupabaseAdmin();
      if (!supabase) {
        res.status(500).json({ ok: false, error: "Supabase admin is not configured" });
        return;
      }
      const { data: source, error: sourceErr } = await supabase
        .from("sources")
        .select("*")
        .eq("id", sourceId)
        .maybeSingle();
      if (sourceErr) {
        res.status(500).json({ ok: false, error: sourceErr.message });
        return;
      }
      if (!source) {
        res.status(404).json({ ok: false, error: "Source not found" });
        return;
      }
      if (shouldUseGoogleSheetsChessboardSync(source)) {
        const gs = await syncGoogleSheetsFromSource(supabase, source);
        if (!gs.ok) {
          res.status(500).json({
            ok: false,
            error: gs.error,
            total: 1,
            failed: 1,
            results: [
              {
                ok: false,
                sourceId: source.id,
                inserted: 0,
                name: source.name,
                type: source.type,
                error: gs.error,
              },
            ],
          });
          return;
        }
        res.status(200).json({
          ok: true,
          total: 1,
          failed: 0,
          results: [
            {
              ok: true,
              sourceId: source.id,
              inserted: gs.count,
              name: source.name,
              type: source.type,
              debug: gs.debug || null,
            },
          ],
        });
        return;
      }
      try {
        const one = await syncSource(source, supabase, { skipImages });
        res.status(200).json({
          ok: true,
          total: 1,
          failed: 0,
          results: [{ ok: true, ...one, name: source.name, type: source.type }],
        });
      } catch (syncErr) {
        res.status(200).json({
          ok: false,
          total: 1,
          failed: 1,
          results: [{
            ok: false,
            sourceId: source.id,
            inserted: 0,
            name: source.name,
            type: source.type,
            error: syncErr?.message || 'Sync failed',
          }],
        });
      }
      return;
    }

    const results = await syncAllSources({ skipImages });
    const failed = results.filter((r) => !r.ok);
    res.status(200).json({
      ok: failed.length === 0,
      total: results.length,
      failed: failed.length,
      results,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Sync failed" });
  }
}

