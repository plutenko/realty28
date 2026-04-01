-- Удаление таблиц OAuth «мой Google» (остался только сервисный аккаунт GOOGLE_SERVICE_ACCOUNT_JSON).

DROP TABLE IF EXISTS public.google_oauth_client CASCADE;
DROP TABLE IF EXISTS public.google_sheets_oauth CASCADE;
