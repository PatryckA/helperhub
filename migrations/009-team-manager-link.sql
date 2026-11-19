-- Run once in the D1 console on databases created before team managers had their own page.
ALTER TABLE teams ADD COLUMN manager_token TEXT NOT NULL DEFAULT '';
