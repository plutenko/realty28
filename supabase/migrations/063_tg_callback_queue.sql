-- 063: Очередь Telegram-callback'ов
--
-- Контейнер Timeweb периодически рестартует по SIGTERM (auto-restart, OOM,
-- внутренняя флапа). В момент рестарта Telegram callback'и от inline-кнопок
-- («🔥 Беру в работу») получают Connection timed out и теряются — TG ретраит
-- ограниченно (~30-60 сек), потом дропает.
--
-- Решение: webhook ВСЕГДА пишет callback в эту очередь, пытается обработать
-- inline (быстрый UX когда контейнер живой), и worker /api/auth/cron/retry-callbacks
-- (cron-job.org каждую минуту) дожимает то что не успело обработаться.
--
-- Идемпотентность: PK по cq_id, повторный INSERT того же callback'а
-- молча скипается (ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS tg_callback_queue (
  cq_id          text PRIMARY KEY,
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'queued',   -- queued | done | failed
  attempts       int  NOT NULL DEFAULT 0,
  last_error     text,
  next_retry_at  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

-- Воркер забирает: status='queued' AND next_retry_at <= now() ORDER BY next_retry_at LIMIT 50
CREATE INDEX IF NOT EXISTS tg_callback_queue_due_idx
  ON tg_callback_queue(status, next_retry_at)
  WHERE status = 'queued';

-- Чистка старых обработанных раз в день (мягкий retention 7 дней).
-- Не делаем CRON для этого — пусть растёт, можно подрезать позже.
