/**
 * Глобальные guard'ы от падения процесса. Срабатывают на стороне Node/Next.js
 * сервера один раз при старте.
 *
 * Зачем: 30.04.2026 произошёл инцидент — Next/Image на странице вызвал
 * EACCES при mkdir /app/.next/cache/images, unhandledRejection положил
 * процесс, контейнер ребутался ~30 сек, в это окно Telegram-callback'и
 * («🔥 Беру» риелторами) ушли в Connection timed out.
 *
 * После этих guard'ов процесс продолжает работу при любых необработанных
 * ошибках — webhook остаётся доступен. Сама проблема Image параллельно
 * пофикшена через images.unoptimized в next.config.
 *
 * Этот файл подхватывается Next.js автоматически (instrumentation hook,
 * см. https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason)
    console.error('[unhandledRejection]', msg, reason?.stack || '')
  })

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err?.message || String(err), err?.stack || '')
  })
}
