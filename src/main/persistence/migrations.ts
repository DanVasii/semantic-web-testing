import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (database: DatabaseSync) => void;
}

export const APPLICATION_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create_projects",
    up(database) {
      database.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          normalized_base_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          browser_config_json TEXT NOT NULL,
          ai_config_json TEXT NOT NULL,
          mysql_config_json TEXT,
          shortcut_config_json TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 2,
    name: "create_pages",
    up(database) {
      database.exec(`
        CREATE TABLE pages (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, normalized_url)
        ) STRICT;

        CREATE INDEX pages_project_id_idx ON pages(project_id);
      `);
    },
  },
  {
    version: 3,
    name: "create_page_versions",
    up(database) {
      database.exec(`
        CREATE TABLE page_versions (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL CHECK(version_number > 0),
          created_at TEXT NOT NULL,
          normalized_url TEXT NOT NULL,
          dom_file_path TEXT NOT NULL,
          css_file_path TEXT NOT NULL,
          accessibility_file_path TEXT NOT NULL,
          analysis_file_path TEXT NOT NULL,
          semantic_hash TEXT NOT NULL,
          UNIQUE(page_id, version_number)
        ) STRICT;

        CREATE INDEX page_versions_page_id_idx ON page_versions(page_id);
      `);
    },
  },
  {
    version: 4,
    name: "create_tests",
    up(database) {
      database.exec(`
        CREATE TABLE tests (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL CHECK(status IN ('draft', 'valid', 'invalidated')),
          version INTEGER NOT NULL CHECK(version > 0),
          wipe_before_run INTEGER NOT NULL CHECK(wipe_before_run IN (0, 1)),
          start_mode TEXT NOT NULL CHECK(start_mode IN ('base_url', 'current_page')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          flow_items_json TEXT NOT NULL
        ) STRICT;

        CREATE INDEX tests_project_id_idx ON tests(project_id);
      `);
    },
  },
  {
    version: 5,
    name: "create_test_versions",
    up(database) {
      database.exec(`
        CREATE TABLE test_versions (
          id TEXT PRIMARY KEY,
          test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL CHECK(version_number > 0),
          source TEXT NOT NULL CHECK(source IN ('manual', 'recorder', 'ai', 'import')),
          created_at TEXT NOT NULL,
          snapshot_file_path TEXT NOT NULL,
          UNIQUE(test_id, version_number)
        ) STRICT;

        CREATE INDEX test_versions_test_id_idx ON test_versions(test_id);
      `);
    },
  },
  {
    version: 6,
    name: "create_datasets",
    up(database) {
      database.exec(`
        CREATE TABLE datasets (
          id TEXT PRIMARY KEY,
          test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          values_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX datasets_test_id_idx ON datasets(test_id);
      `);
    },
  },
  {
    version: 7,
    name: "create_runs",
    up(database) {
      database.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
          test_version INTEGER NOT NULL CHECK(test_version > 0),
          dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          status TEXT NOT NULL CHECK(status IN (
            'running', 'passed', 'passed_with_warnings', 'failed', 'stopped'
          )),
          browser_type TEXT NOT NULL CHECK(browser_type IN (
            'chrome', 'chromium', 'firefox', 'webkit'
          )),
          page_version_ids_json TEXT NOT NULL
        ) STRICT;

        CREATE INDEX runs_project_id_idx ON runs(project_id);
        CREATE INDEX runs_test_id_idx ON runs(test_id);
      `);
    },
  },
  {
    version: 8,
    name: "create_step_results",
    up(database) {
      database.exec(`
        CREATE TABLE step_results (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          step_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN (
            'pending', 'running', 'passed', 'passed_with_fallback',
            'skipped', 'failed', 'stopped'
          )),
          started_at TEXT,
          ended_at TEXT,
          locator_used_json TEXT,
          fallback_index INTEGER,
          error_json TEXT,
          logs_json TEXT NOT NULL
        ) STRICT;

        CREATE INDEX step_results_run_id_idx ON step_results(run_id);
      `);
    },
  },
  {
    version: 9,
    name: "create_imap_accounts",
    up(database) {
      database.exec(`
        CREATE TABLE imap_accounts (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
          secure INTEGER NOT NULL CHECK(secure IN (0, 1)),
          username TEXT NOT NULL,
          password TEXT NOT NULL,
          mailbox TEXT NOT NULL
        ) STRICT;

        CREATE INDEX imap_accounts_project_id_idx ON imap_accounts(project_id);
      `);
    },
  },
  {
    version: 10,
    name: "create_project_settings",
    up(database) {
      database.exec(`
        CREATE TABLE project_settings (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          url_patterns_json TEXT NOT NULL,
          semantic_change_threshold REAL NOT NULL DEFAULT 0.3
            CHECK(semantic_change_threshold BETWEEN 0 AND 1),
          settings_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 11,
    name: "add_recording_first_test_workflow",
    up(database) {
      database.exec(`
        ALTER TABLE tests ADD COLUMN start_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE tests ADD COLUMN normalized_start_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE tests ADD COLUMN workflow_state TEXT NOT NULL DEFAULT 'not_recorded'
          CHECK(workflow_state IN (
            'not_recorded', 'recording', 'recorded', 'analyzing_flow',
            'flow_analyzed', 'ready'
          ));

        UPDATE tests
        SET
          start_url = (
            SELECT normalized_base_url
            FROM projects
            WHERE projects.id = tests.project_id
          ),
          normalized_start_url = (
            SELECT normalized_base_url
            FROM projects
            WHERE projects.id = tests.project_id
          ),
          workflow_state = CASE
            WHEN status = 'valid' AND flow_items_json <> '[]' THEN 'ready'
            WHEN flow_items_json <> '[]' THEN 'recorded'
            ELSE 'not_recorded'
          END;
      `);
    },
  },
  {
    version: 12,
    name: "add_run_warnings",
    up(database) {
      database.exec(`
        ALTER TABLE runs
        ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';
      `);
    },
  },
  {
    version: 13,
    name: "create_project_basic_auth",
    up(database) {
      database.exec(`
        CREATE TABLE project_basic_auth (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          origin TEXT NOT NULL,
          username TEXT NOT NULL,
          encrypted_password TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 14,
    name: "create_application_ai_settings",
    up(database) {
      database.exec(`
        CREATE TABLE application_ai_settings (
          singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
          provider TEXT NOT NULL CHECK(provider IN ('none', 'ollama', 'gemini')),
          ollama_base_url TEXT NOT NULL,
          ollama_model TEXT NOT NULL,
          gemini_model TEXT NOT NULL,
          encrypted_gemini_api_key TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 15,
    name: "add_test_mode",
    up(database) {
      database.exec(`
        ALTER TABLE tests
        ADD COLUMN test_mode TEXT NOT NULL DEFAULT 'recorded'
        CHECK(test_mode IN ('recorded', 'dynamic_ai'));
      `);
    },
  },
  {
    version: 16,
    name: "create_project_mysql_settings",
    up(database) {
      database.exec(`
        CREATE TABLE project_mysql_settings (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          host TEXT NOT NULL,
          port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
          database_name TEXT NOT NULL,
          username TEXT NOT NULL,
          encrypted_password TEXT NOT NULL,
          ssl INTEGER NOT NULL CHECK(ssl IN (0, 1)),
          identity_config_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 17,
    name: "create_mysql_run_snapshots_and_cleanup_logs",
    up(database) {
      database.exec(`
        CREATE TABLE mysql_run_snapshots (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('baseline', 'current')),
          check_step_id TEXT,
          captured_at TEXT NOT NULL,
          tables_json TEXT NOT NULL
        ) STRICT;

        CREATE UNIQUE INDEX mysql_run_baseline_unique
          ON mysql_run_snapshots(run_id)
          WHERE kind = 'baseline';

        CREATE TABLE mysql_run_diffs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          check_step_id TEXT NOT NULL,
          baseline_snapshot_id TEXT NOT NULL
            REFERENCES mysql_run_snapshots(id) ON DELETE CASCADE,
          current_snapshot_id TEXT NOT NULL
            REFERENCES mysql_run_snapshots(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          tables_json TEXT NOT NULL
        ) STRICT;

        CREATE TABLE mysql_cleanup_logs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          diff_id TEXT NOT NULL REFERENCES mysql_run_diffs(id) ON DELETE CASCADE,
          preview_id TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK(status IN ('pending', 'completed', 'failed')),
          started_at TEXT NOT NULL,
          ended_at TEXT,
          rows_json TEXT NOT NULL,
          affected_rows INTEGER NOT NULL DEFAULT 0,
          error TEXT
        ) STRICT;
      `);
    },
  },
  {
    version: 18,
    name: "add_test_post_run_checks",
    up(database) {
      database.exec(`
        ALTER TABLE tests
        ADD COLUMN post_run_checks_json TEXT NOT NULL
        DEFAULT '{"aiPrompt":"","mysql":{"enabled":false,"tableNames":[],"identities":[]},"imap":{"enabled":false,"accountIds":[],"mailbox":"INBOX","sender":"","recipient":"","subjectEquals":"","subjectContains":"","bodyContains":""}}';
      `);
    },
  },
  {
    version: 19,
    name: "make_imap_accounts_global",
    up(database) {
      database.exec(`
        CREATE TABLE global_imap_accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
          secure INTEGER NOT NULL CHECK(secure IN (0, 1)),
          username TEXT NOT NULL,
          password TEXT NOT NULL,
          mailbox TEXT NOT NULL
        ) STRICT;

        INSERT INTO global_imap_accounts (
          id, name, host, port, secure, username, password, mailbox
        )
        SELECT id, name, host, port, secure, username, password, mailbox
        FROM imap_accounts;
      `);
    },
  },
  {
    version: 20,
    name: "add_page_change_detection",
    up(database) {
      database.exec(`
        ALTER TABLE page_versions
        ADD COLUMN change_json TEXT;

        ALTER TABLE tests
        ADD COLUMN invalidation_json TEXT;
      `);
    },
  },
  {
    version: 21,
    name: "add_run_history_details",
    up(database) {
      database.exec(`
        ALTER TABLE runs
        ADD COLUMN dataset_snapshot_json TEXT;

        ALTER TABLE runs
        ADD COLUMN post_run_result_json TEXT;

        ALTER TABLE runs
        ADD COLUMN error_json TEXT;
      `);
    },
  },
  {
    version: 22,
    name: "add_ai_test_generation_metadata",
    up(database) {
      database.exec(`
        ALTER TABLE tests
        ADD COLUMN ai_generation_json TEXT;
      `);
    },
  },
  {
    version: 23,
    name: "add_lm_studio_ai_provider",
    up(database) {
      database.exec(`
        ALTER TABLE application_ai_settings
        RENAME TO application_ai_settings_legacy;

        CREATE TABLE application_ai_settings (
          singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
          provider TEXT NOT NULL
            CHECK(provider IN ('none', 'ollama', 'lm_studio', 'gemini')),
          ollama_base_url TEXT NOT NULL,
          ollama_model TEXT NOT NULL,
          lm_studio_base_url TEXT NOT NULL,
          lm_studio_model TEXT NOT NULL,
          gemini_model TEXT NOT NULL,
          encrypted_gemini_api_key TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO application_ai_settings (
          singleton_id, provider, ollama_base_url, ollama_model,
          lm_studio_base_url, lm_studio_model, gemini_model,
          encrypted_gemini_api_key, updated_at
        )
        SELECT
          singleton_id, provider, ollama_base_url, ollama_model,
          'http://127.0.0.1:1234', '', gemini_model,
          encrypted_gemini_api_key, updated_at
        FROM application_ai_settings_legacy;

        DROP TABLE application_ai_settings_legacy;
      `);
    },
  },
  {
    version: 24,
    name: "create_test_suites",
    up(database) {
      database.exec(`
        CREATE TABLE test_suites (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          items_json TEXT NOT NULL,
          settings_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX test_suites_project_id_idx ON test_suites(project_id);
      `);
    },
  },
  {
    version: 25,
    name: "create_batch_runs",
    up(database) {
      database.exec(`
        CREATE TABLE batch_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          suite_id TEXT REFERENCES test_suites(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','passed','failed','stopped')),
          settings_json TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          cleanup_status TEXT CHECK(cleanup_status IN ('preserved','completed','failed'))
        ) STRICT;

        CREATE TABLE batch_run_items (
          id TEXT PRIMARY KEY,
          batch_run_id TEXT NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
          test_id TEXT NOT NULL,
          test_name TEXT NOT NULL,
          position INTEGER NOT NULL CHECK(position >= 0),
          dataset_id TEXT,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK(status IN (
            'queued','running','passed','flaky','failed','stopped','skipped'
          )),
          retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
          error TEXT
        ) STRICT;

        CREATE INDEX batch_runs_project_id_idx ON batch_runs(project_id);
        CREATE INDEX batch_run_items_batch_id_idx ON batch_run_items(batch_run_id);
        CREATE INDEX batch_run_items_test_id_idx ON batch_run_items(test_id);
      `);
    },
  },
  {
    version: 26,
    name: "create_run_artifacts",
    up(database) {
      database.exec(`
        CREATE TABLE run_artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('screenshot','html','console','network','trace')),
          file_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX run_artifacts_run_id_idx ON run_artifacts(run_id);
      `);
    },
  },
  {
    version: 27,
    name: "add_multi_flow_test_stages",
    up(database) {
      database.exec(`
        ALTER TABLE tests
        ADD COLUMN stages_json TEXT;

        ALTER TABLE step_results
        ADD COLUMN stage_id TEXT;

        CREATE INDEX step_results_stage_id_idx
          ON step_results(run_id, stage_id);

        DROP INDEX mysql_run_baseline_unique;

        CREATE UNIQUE INDEX mysql_run_baseline_stage_unique
          ON mysql_run_snapshots(run_id, check_step_id)
          WHERE kind = 'baseline';
      `);
    },
  },
  {
    version: 28,
    name: "add_openai_ai_provider",
    up(database) {
      database.exec(`
        ALTER TABLE application_ai_settings
        RENAME TO application_ai_settings_legacy;

        CREATE TABLE application_ai_settings (
          singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
          provider TEXT NOT NULL
            CHECK(provider IN ('none', 'ollama', 'lm_studio', 'gemini', 'openai')),
          ollama_base_url TEXT NOT NULL,
          ollama_model TEXT NOT NULL,
          lm_studio_base_url TEXT NOT NULL,
          lm_studio_model TEXT NOT NULL,
          gemini_model TEXT NOT NULL,
          encrypted_gemini_api_key TEXT,
          openai_model TEXT NOT NULL,
          encrypted_openai_api_key TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO application_ai_settings (
          singleton_id, provider, ollama_base_url, ollama_model,
          lm_studio_base_url, lm_studio_model, gemini_model,
          encrypted_gemini_api_key, openai_model,
          encrypted_openai_api_key, updated_at
        )
        SELECT
          singleton_id, provider, ollama_base_url, ollama_model,
          lm_studio_base_url, lm_studio_model, gemini_model,
          encrypted_gemini_api_key, '', NULL, updated_at
        FROM application_ai_settings_legacy;

        DROP TABLE application_ai_settings_legacy;
      `);
    },
  },
  {
    version: 29,
    name: "create_ai_model_pricing_cache",
    up(database) {
      database.exec(`
        CREATE TABLE ai_model_pricing_cache (
          provider TEXT NOT NULL CHECK(provider IN ('gemini', 'openai')),
          model TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('litellm', 'manual')),
          input_per_million_usd REAL,
          output_per_million_usd REAL,
          cached_input_per_million_usd REAL,
          matched_model_id TEXT,
          fetched_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          PRIMARY KEY(provider, model)
        ) STRICT;
      `);
    },
  },
];

export const assertValidMigrations = (
  migrations: readonly Migration[],
): void => {
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid migration version: ${migration.version}.`);
    }

    if (migration.version <= previousVersion) {
      throw new Error(
        "Migrations must be ordered by unique ascending version.",
      );
    }

    previousVersion = migration.version;
  }
};
