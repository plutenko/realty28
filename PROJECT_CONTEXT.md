# Проект: агрегатор шахматок новостроек Благовещенск

## Суть проекта
Сервис для риелторов — агрегирует шахматки квартир от разных застройщиков 
в единый интерфейс. Аналог Авито/Циан но только для новостроек одного города.

## Стек
- Next.js (pages router)
- Supabase (PostgreSQL)
- Vercel (хостинг)
- Google OAuth + Service Account (для чтения Google Sheets)

## Источники данных застройщиков
- Profitbase API — уже работает
- Google Sheets — реализовано через Google OAuth (личный аккаунт)
- CSV, ручной ввод — в планах

## Застройщик Содружество
- Шахматка в Google Sheets: одна таблица, каждый литер = отдельная вкладка
- Структура: 3 строки на этаж (A=номер/площадь/тип, B=цена/м², C=цена руб)
- Парсер: lib/parsers/googleSheets.js → parseGoogleSheetsChessboard()
- Особенности парсера:
  * Коммерческие помещения на 1 этаже (текст "Помещение 1.1" вместо числа)
  * Двухуровневые квартиры (merged cells через 2 этажа, span_floors=2)
  * Статус по цвету ячеек (легенда в колонке AA)
  * floor = нижний этаж охвата, span_floors=2 значит карточка занимает 2 этажа

## Ключевые файлы
- pages/admin/sources.js — управление источниками синхронизации
- lib/syncGoogleSheetsFromSource.js — синхронизация Google Sheets
- lib/parsers/googleSheets.js — парсер шахматки
- lib/syncSources.js — роутер синхронизации
- components/BuildingChessboard.jsx — визуализация шахматки
- pages/admin/units.js — админка квартир

## Структура БД (ключевые таблицы)
- developers → complexes → buildings → units
- sources (type, parser_type, url с gid для Google Sheets)
- units: external_id, floor, span_floors, is_commercial, position, status

## Текущий статус
- Синхронизация Google Sheets работает через OAuth
- Парсер Содружества работает включая коммерцию и двухуровневые
- Позиции двухуровневых квартир в процессе исправления (дублируются)

## Следующая задача
Исправить computePosition в lib/syncGoogleSheetsFromSource.js:
position = (number % 100) || unitsPerFloor
Это даст правильные позиции: 2401→1, 2402→2 ... 2407→7
