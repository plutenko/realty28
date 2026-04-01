-- Добавляем тип источника profitbase
ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('google', 'csv', 'api', 'profitbase'));

