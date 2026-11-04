CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY,
  query TEXT NOT NULL,
  film TEXT,
  shot_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_click (
  id INTEGER PRIMARY KEY,
  search_id INTEGER NOT NULL REFERENCES search_log (id),
  shot_id INTEGER NOT NULL,
  rank INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS search_click_by_search ON search_click (search_id);
