CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  build_command TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  project_name TEXT NOT NULL UNIQUE,
  url TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_deployment_id TEXT,
  last_error TEXT,
  domain TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_app_id ON logs(app_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, created_at);
