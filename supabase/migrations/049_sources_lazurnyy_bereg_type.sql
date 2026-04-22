-- Разрешаем тип источника lazurnyy_bereg (Tilda Store у ЖК «Лазурный берег»,
-- застройщик lazurnyybereg.com). Сайт поднят на Tilda, каталог квартир —
-- store part в tilda catalog, парсим через store.tildaapi.com/getproductslist.
ALTER TABLE public.sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN (
    'google',
    'google_sheets',
    'csv',
    'api',
    'profitbase',
    'macrocrm',
    'fsk',
    'pik',
    'amurstroy',
    'lazurnyy_bereg'
  ));
