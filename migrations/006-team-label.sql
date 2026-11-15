-- Run once in the D1 console on databases created before groups could name their teams (classes, stalls...).
ALTER TABLE groups ADD COLUMN team_label TEXT NOT NULL DEFAULT '';
