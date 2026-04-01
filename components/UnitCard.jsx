export default function UnitCard({ unit }) {
  const project = unit.project || null;
  const heroImage = project?.hero_image_url || null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      {heroImage ? (
        <div className="aspect-[4/3] bg-slate-950/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImage}
            alt={project?.name || "ЖК"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : unit.layout_image_url ? (
        <div className="aspect-[4/3] bg-slate-950/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={unit.layout_image_url}
            alt={unit.layout_title || "Планировка"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-50">
            {unit.rooms ? `${unit.rooms}-к` : "Квартира"} ·{" "}
            {unit.area_m2 ? `${unit.area_m2} м²` : "—"}
          </span>
          {unit.floor != null ? (
            <span className="text-xs text-slate-300 px-2 py-1 rounded-full border border-slate-800 bg-slate-900/60">
              этаж {unit.floor}
            </span>
          ) : null}
          {unit.orientation ? (
            <span className="text-xs text-slate-300 px-2 py-1 rounded-full border border-slate-800 bg-slate-900/60">
              {unit.orientation}
            </span>
          ) : null}
        </div>

        {project?.name || unit.project_name ? (
          <div className="text-xs text-slate-300">
            {project?.name || unit.project_name}
          </div>
        ) : null}

        <div className="flex items-end justify-between gap-3">
          <div className="text-sm text-slate-200">
            {unit.price_rub != null ? (
              <span className="font-semibold">
                {Number(unit.price_rub).toLocaleString("ru-RU")} ₽
              </span>
            ) : (
              <span className="text-slate-400">цена по запросу</span>
            )}
          </div>
        </div>

        {unit.finish_image_url ? (
          <div className="pt-2">
            <div className="text-[11px] text-slate-400 mb-1">Пример отделки</div>
            <div className="aspect-[16/9] rounded-xl overflow-hidden border border-slate-800 bg-slate-950/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={unit.finish_image_url}
                alt="Пример отделки"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

