-- Перенос legacy `developer_contacts` → единая таблица `developer_managers`, затем удаление старой таблицы.
-- Выполните после `003_developer_managers.sql`, если у вас уже была таблица developer_contacts.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'developer_contacts'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'developer_managers'
  ) THEN
    INSERT INTO public.developer_managers (
      id,
      developer_id,
      name,
      phone,
      short_description,
      messenger,
      created_at
    )
    SELECT
      dc.id,
      dc.developer_id,
      dc.name,
      dc.phone,
      dc.note,
      'telegram',
      dc.created_at
    FROM public.developer_contacts dc
    ON CONFLICT (id) DO NOTHING;

    DROP TABLE public.developer_contacts CASCADE;
  END IF;
END $$;
