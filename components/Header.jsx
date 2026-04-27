export default function Header() {
  return (
    <header className="w-full border-b border-slate-800 bg-slate-900/60 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">
          Cursor AI Starter
        </span>
        <nav className="flex items-center gap-4 text-xs text-slate-300">
          <a href="/admin" className="hover:text-white">
            Админка
          </a>
          <a href="/apartments" className="hover:text-white">
            Квартиры
          </a>
          <a
            href="https://nextjs.org/docs"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            Next.js Docs
          </a>
          <a
            href="https://tailwindcss.com/docs"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            Tailwind Docs
          </a>
          <a
            href="https://supabase.com/docs"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            Supabase Docs
          </a>
        </nav>
      </div>
    </header>
  );
}

