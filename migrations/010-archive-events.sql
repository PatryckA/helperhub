-- Run once in the D1 console on databases created before events could be archived.
ALTER TABLE events ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
