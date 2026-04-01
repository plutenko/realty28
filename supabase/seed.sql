-- Demo data (optional). Run after schema.sql

insert into public.units (
  project_name, rooms, area_m2, floor, price_rub, orientation,
  layout_title, layout_image_url, finish_image_url
) values
(
  'ЖК Тестовый', 1, 36.8, 5, 5900000, 'ЮВ',
  '1-к 36.8', null, null
),
(
  'ЖК Тестовый', 2, 54.2, 9, 7900000, 'Ю',
  '2-к 54.2', null, null
);

