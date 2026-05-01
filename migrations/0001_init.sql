CREATE TABLE posts (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  authorId  TEXT NOT NULL
);

CREATE INDEX idx_posts_authorId ON posts(authorId);
