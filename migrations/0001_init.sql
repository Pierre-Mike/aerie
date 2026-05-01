CREATE TABLE users (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE posts (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  authorId  TEXT NOT NULL,
  FOREIGN KEY (authorId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_posts_authorId ON posts(authorId);
