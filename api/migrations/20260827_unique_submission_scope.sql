DELETE FROM submissions AS older
USING submissions AS newer
WHERE older.id < newer.id
  AND older.name = newer.name
  AND older."monthKey" = newer."monthKey"
  AND older.date = newer.date;

SELECT setval(
  pg_get_serial_sequence('submissions', 'id'),
  COALESCE((SELECT MAX(id) FROM submissions), 1),
  EXISTS (SELECT 1 FROM submissions)
);

CREATE UNIQUE INDEX IF NOT EXISTS submissions_name_month_date_unique
ON submissions (name, "monthKey", date);
