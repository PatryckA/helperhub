-- Run once in the D1 console on databases created before organisers could be nominated for updates.
ALTER TABLE memberships ADD COLUMN gets_updates INTEGER NOT NULL DEFAULT 0; ALTER TABLE events ADD COLUMN update_to TEXT;
