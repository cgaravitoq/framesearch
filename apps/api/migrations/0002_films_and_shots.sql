CREATE TABLE IF NOT EXISTS films (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id INTEGER PRIMARY KEY,
  film TEXT NOT NULL REFERENCES films (slug) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  time REAL NOT NULL,
  shot_start REAL NOT NULL,
  shot_end REAL NOT NULL,
  caption TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  UNIQUE (film, idx)
);

CREATE VIRTUAL TABLE IF NOT EXISTS shots_fts USING fts5(
  caption,
  tokenize = 'porter'
);
