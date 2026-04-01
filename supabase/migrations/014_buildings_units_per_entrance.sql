-- Кол-во квартир по подъездам (могут отличаться).
-- Пример ввода: "4,5" означает 2 подъезда: первый по 4 квартиры, второй по 5.
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS units_per_entrance int[] NOT NULL DEFAULT '{}';

-- Для удобства: если units_per_floor пустой/не задан, фронт/код может использовать sum(units_per_entrance).
-- (Мы не меняем units_per_floor автоматически на уровне БД, это делается в админке.)

