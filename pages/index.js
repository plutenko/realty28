import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import { testConnection } from "../lib/supabaseClient";

export default function Home() {
  const [status, setStatus] = useState("checking");

  const statusLabel = useMemo(() => {
    switch (status) {
      case "ok":
        return "Supabase: connected";
      case "checking":
        return "Supabase: checking…";
      case "not_configured":
        return "Supabase: not configured";
      case "error":
        return "Supabase: error";
      default:
        return "Supabase: unknown";
    }
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const isConfigured = Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

        if (!isConfigured) {
          if (!cancelled) setStatus("not_configured");
          return;
        }

        await testConnection();
        if (!cancelled) setStatus("ok");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-xl text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            Next.js + Tailwind + Supabase
          </h1>
          <div className="text-base font-semibold tracking-tight text-slate-100">
            СОБР новостройки Благовещенска
          </div>
          <p className="text-slate-300">
            Стартовый шаблон проекта. Tailwind уже подключён, Supabase готов к
            настройке.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-slate-400">
            <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800">
              pages/
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800">
              components/
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800">
              {statusLabel}
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800">
              Tailwind configured
            </span>
          </div>

          <a
            href="/apartments"
            className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
          >
            Подобрать квартиры
          </a>

          {status === "not_configured" ? (
            <div className="text-xs text-slate-400 leading-relaxed">
              Добавь переменные в <code className="text-slate-200">.env.local</code>{" "}
              (см. <code className="text-slate-200">.env.local.example</code>) и
              перезапусти <code className="text-slate-200">npm run dev</code>.
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

