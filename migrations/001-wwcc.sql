-- Run once in the D1 console on databases created before Working with Children Check support.
ALTER TABLE slots ADD COLUMN needs_wwcc INTEGER NOT NULL DEFAULT 0; ALTER TABLE signups ADD COLUMN wwcc_number TEXT NOT NULL DEFAULT ''; ALTER TABLE signups ADD COLUMN wwcc_expiry TEXT NOT NULL DEFAULT '';
