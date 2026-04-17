-- Change units.number from integer to text to support commercial unit numbers like "1.1"
ALTER TABLE units ALTER COLUMN number TYPE text USING number::text;
