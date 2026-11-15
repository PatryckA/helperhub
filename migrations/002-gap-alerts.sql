-- Run once in the D1 console on databases created before unfilled-spot alerts.
ALTER TABLE events ADD COLUMN gap_alerts TEXT; ALTER TABLE events ADD COLUMN gap_alert_emails TEXT NOT NULL DEFAULT ''; ALTER TABLE events ADD COLUMN gap_alerts_sent TEXT NOT NULL DEFAULT '';
