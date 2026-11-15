-- Run once in the D1 console on databases created before "who's doing what" updates.
ALTER TABLE events ADD COLUMN roster_alerts TEXT; ALTER TABLE events ADD COLUMN roster_alerts_sent TEXT NOT NULL DEFAULT '';
