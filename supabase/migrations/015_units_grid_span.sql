-- Шахматка: объединение квартир по горизонтали и вертикали.
-- anchor: floor — верхний этаж объединения (как на карточке «сверху вниз»),
-- position — левая колонка; span_columns / span_floors — ширина и «высота» в ячейках.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS span_columns integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS span_floors integer NOT NULL DEFAULT 1;

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_span_columns_check;
ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_span_floors_check;

ALTER TABLE public.units
  ADD CONSTRAINT units_span_columns_check CHECK (span_columns >= 1),
  ADD CONSTRAINT units_span_floors_check CHECK (span_floors >= 1);
