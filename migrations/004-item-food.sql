-- Run once in the D1 console on databases created before the "This is food" item option. Existing items stay as food.
ALTER TABLE slots ADD COLUMN is_food INTEGER NOT NULL DEFAULT 1;
