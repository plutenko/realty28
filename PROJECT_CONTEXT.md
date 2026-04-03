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
- Profitbase API — уже работает; этаж в шахматке при синке берётся из **номера квартиры** (201→2 этаж, 2401→24), если номер — обычные цифры, иначе остаётся этаж ячейки из smallGrid (у доски и маркетинга этаж иногда расходятся)
- Google Sheets — реализовано через Google OAuth (личный аккаунт)
- CSV, ручной ввод — в планах

## Застройщик Содружество
- **Источник данных — только Google Sheets, не Profitbase.** В админке источник с типом Google Sheets / парсер `sodruzhestvo` (или `default` для того же `parseGoogleSheetsChessboard`), URL с `#gid=…` на нужный литер. Синхронизация: `lib/syncGoogleSheetsFromSource.js` → `upsertImportedUnits`, без Profitbase API.
- **Пример:** литер **14А** — вкладка Google-таблицы. Для **обычных** (не двухуровневых) квартир этаж в БД: если номер однозначно кодирует этаж (`201`→2), берётся из номера (`lib/inferFloorFromFlatNumber.js`), иначе из колонки A парсера — так исправляется сдвиг этажа в xlsx. У `span_floors=2` нижний этаж остаётся как рассчитал парсер по merged cells.
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
- Парсер Содружества: коммерция, двухуровневые (`span_floors=2`), статус по цвету, **позиция колонки** в сетке передаётся из парсера как `position: k + 1` (пропуски осей в таблице, напр. лифт между 2402 и 2403)
- В админке шахматка: двухуровневые не «рвут» нижний ряд при `entrance = null`; диапазон этажей — от фактического минимального `floor` квартир, без лишних пустых этажей снизу

## Заметки
- Другие застройщики могут идти через **Profitbase** (`lib/profitbaseSourceSync.js`, `parser_type` / тип источника в админке) — не смешивать с потоком Содружества
