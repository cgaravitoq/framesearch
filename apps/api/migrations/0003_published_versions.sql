CREATE TABLE IF NOT EXISTS published (
  film TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);

INSERT OR IGNORE INTO published (film, version)
  SELECT slug, CAST(strftime('%s', 'now') AS INTEGER) FROM films;
