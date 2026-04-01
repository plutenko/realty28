-- Статус продажи квартиры (для шахматки: доступна / продана)
alter table public.units
  add column if not exists sale_status text default 'available';

comment on column public.units.sale_status is 'available | sold (и т.п.)';
