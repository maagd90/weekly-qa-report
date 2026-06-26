import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/qa_dashboard.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      resource_id TEXT PRIMARY KEY,
      resource_name TEXT NOT NULL,
      team TEXT,
      role TEXT,
      active TEXT DEFAULT 'Yes'
    );

    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      project_manager TEXT,
      start_date TEXT,
      target_end_date TEXT,
      overall_status TEXT,
      active TEXT DEFAULT 'Yes'
    );

    CREATE TABLE IF NOT EXISTS crs (
      cr_id TEXT PRIMARY KEY,
      project_id TEXT,
      cr_title TEXT NOT NULL,
      priority TEXT,
      status TEXT,
      owner TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id)
    );

    CREATE TABLE IF NOT EXISTS weekly_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      week_number INTEGER NOT NULL,
      week_start TEXT,
      week_end TEXT,
      resource_id TEXT NOT NULL,
      cr_id TEXT NOT NULL,
      tc_planned INTEGER DEFAULT 0,
      tc_executed INTEGER DEFAULT 0,
      tc_passed INTEGER DEFAULT 0,
      tc_failed INTEGER DEFAULT 0,
      bugs_reported INTEGER DEFAULT 0,
      bugs_closed INTEGER DEFAULT 0,
      hours_spent REAL DEFAULT 0,
      notes TEXT,
      UNIQUE(year, week_number, resource_id, cr_id)
    );

    CREATE TABLE IF NOT EXISTS project_status_weekly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      week_number INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      percent_complete REAL DEFAULT 0,
      tests_executed INTEGER DEFAULT 0,
      bugs_open INTEGER DEFAULT 0,
      bugs_reported INTEGER DEFAULT 0,
      bugs_closed INTEGER DEFAULT 0,
      resources_assigned INTEGER DEFAULT 0,
      key_accomplishments TEXT,
      risks TEXT,
      blockers TEXT,
      next_week_plan TEXT,
      reported_by TEXT,
      UNIQUE(year, week_number, project_id),
      FOREIGN KEY (project_id) REFERENCES projects(project_id)
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at TEXT NOT NULL,
      source_file TEXT,
      rows_added INTEGER DEFAULT 0,
      rows_updated INTEGER DEFAULT 0,
      rows_skipped INTEGER DEFAULT 0,
      errors TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS column_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      mapping_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      report_type TEXT,
      project_id TEXT,
      report_markdown TEXT,
      tool_calls_json TEXT
    );
  `);
}
