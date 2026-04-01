import { useEffect, useState } from "react";
import Header from "../../components/Header";
import { supabase } from "../../lib/supabaseClient";
import ApartmentCard from "../../components/apartments/ApartmentCard";

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

export default function CollectionPage({ token }) {
  const [loading, setLoading] = useState(true);
  const [collection, setCollection] = useState(null);
  const [units, setUnits] = useState([]);
  const [missingCount, setMissingCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function bumpViews(initialCount) {
      let next = initialCount;
      try {
        const resp = await fetch("/api/collections/view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          }),
        });
        if (resp.ok) {
          const vBody = await resp.json();
          if (typeof vBody.views_count === "number") next = vBody.views_count;
        }
      } catch {
        //
      }
      if (!cancelled) {
        setCollection((prev) => (prev ? { ...prev, views_count: next } : prev));
      }
    }

    async function loadFromClient() {
      if (!supabase) {
        setError(
          "Supabase не настроен. Добавь NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local."
        );
        setLoading(false);
        return;
      }

      const { data: c, error: cErr } = await supabase
        .from("collections")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (cErr) throw cErr;
      if (!c) {
        setError("Подборка не найдена.");
        setLoading(false);
        return;
      }

      let unitIds = Array.isArray(c.units) ? c.units : [];
      if (unitIds.length === 0) {
        const { data: mapRows, error: mapErr } = await supabase
          .from("collection_units")
          .select("unit_id, sort_order")
          .eq("collection_id", c.id)
          .order("sort_order", { ascending: true });
        if (!mapErr && Array.isArray(mapRows)) {
          unitIds = mapRows.map((r) => r.unit_id).filter(Boolean);
        }
      }

      unitIds = uniqueUnitIdsPreserveOrder(unitIds);

      let rows = [];
      if (unitIds.length > 0) {
        const { data: unitsData, error: rErr } = await supabase
          .from("units")
          .select(UNITS_SELECT)
          .in("id", unitIds);
        if (rErr) throw rErr;
        rows = unitsData ?? [];
      }

      const byId = new Map((rows ?? []).map((u) => [String(u.id), u]));
      const orderedUnits = unitIds.map((id) => byId.get(String(id))).filter(Boolean);

      if (!cancelled) {
        setCollection(c);
        setUnits(orderedUnits);
        setMissingCount(Math.max(0, unitIds.length - orderedUnits.length));
        setLoading(false);
        await bumpViews(Number(c.views_count ?? 0));
      }
    }

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setMissingCount(0);

        const apiRes = await fetch(
          `/api/collections/public?token=${encodeURIComponent(token)}`
        );

        if (apiRes.ok) {
          const body = await apiRes.json();
          if (cancelled) return;
          setCollection(body.collection);
          setUnits(body.units ?? []);
          setMissingCount(Number(body.missingCount ?? 0));
          setLoading(false);
          await bumpViews(Number(body.collection?.views_count ?? 0));
          return;
        }

        if (apiRes.status === 404) {
          if (!cancelled) {
            setError("Подборка не найдена.");
            setLoading(false);
          }
          return;
        }

        await loadFromClient();
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Ошибка загрузки подборки.");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 px-4 py-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="space-y-1">
            <div className="text-sm text-slate-400">Подборка</div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              {collection?.title || "Квартиры в новостройках"}
            </h1>
            {collection?.client_name ? (
              <div className="text-sm text-slate-300">
                Для клиента: <span className="font-medium">{collection.client_name}</span>
              </div>
            ) : null}
            {collection && Object.prototype.hasOwnProperty.call(collection, "views_count") ? (
              <div className="text-sm text-slate-300">
                Просмотров:{" "}
                <span className="font-semibold text-white">{collection?.views_count ?? 0}</span>
              </div>
            ) : null}
            {collection?.created_at ? (
              <div className="text-xs text-slate-400">
                Сформировано:{" "}
                {new Date(collection.created_at).toLocaleString("ru-RU")}
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="text-sm text-slate-300">Загрузка…</div>
          ) : error ? (
            <div className="text-sm text-rose-300">{error}</div>
          ) : (
            <>
              {units.length === 0 ? (
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
                  <p>Квартиры в этой подборке не отображаются.</p>
                  {missingCount > 0 ? (
                    <p className="mt-2 text-slate-400">
                      В подборке числилось объектов: {missingCount}, но в каталоге они не найдены
                      (возможно, удалены или сменилась база).
                    </p>
                  ) : (
                    <p className="mt-2 text-slate-400">
                      Список квартир пуст. Создайте подборку заново со страницы «Квартиры».
                    </p>
                  )}
                </div>
              ) : null}
              {missingCount > 0 && units.length > 0 ? (
                <div className="text-xs text-amber-200/90">
                  Не найдено в каталоге: {missingCount}{" "}
                  {missingCount === 1 ? "позиция" : "позиций"} из подборки.
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {units.map((u) => (
                  <ApartmentCard key={u.id} unit={u} />
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export async function getServerSideProps(ctx) {
  return {
    props: {
      token: ctx.params?.token ? String(ctx.params.token) : "",
    },
  };
}
