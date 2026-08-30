import type { SqliteMigration } from '../../../db/migrations'

export const MATERIALS_DB_SCHEMA_VERSION = 4

export const MATERIALS_SCHEMA_V4_MIGRATION: SqliteMigration = {
  version: MATERIALS_DB_SCHEMA_VERSION,
  name: 'materials-version-store-foundation',
  up: (db) => {
    db.exec(`
      CREATE TABLE materials_projects (
        project_id       TEXT PRIMARY KEY
          CHECK (length(trim(project_id)) > 0),
        board_id         TEXT NOT NULL
          CHECK (length(trim(board_id)) > 0),
        workflow_profile TEXT NOT NULL
          CHECK (workflow_profile = 'materials_rnd'),
        status           TEXT NOT NULL
          CHECK (length(trim(status)) > 0),
        created_at       TEXT NOT NULL
          CHECK (length(trim(created_at)) > 0),
        updated_at       TEXT NOT NULL
          CHECK (length(trim(updated_at)) > 0),
        created_by_kind  TEXT NOT NULL
          CHECK (length(trim(created_by_kind)) > 0),
        created_by_id    TEXT NOT NULL
          CHECK (length(trim(created_by_id)) > 0)
      );

      CREATE INDEX idx_materials_projects_board_id
        ON materials_projects(board_id);

      CREATE TABLE materials_object_versions (
        record_id             TEXT PRIMARY KEY
          CHECK (length(trim(record_id)) > 0),
        project_id            TEXT NOT NULL,
        contract_id           TEXT NOT NULL
          CHECK (length(trim(contract_id)) > 0),
        entity_id             TEXT NOT NULL
          CHECK (length(trim(entity_id)) > 0),
        entity_revision       INTEGER NOT NULL
          CHECK (typeof(entity_revision) = 'integer' AND entity_revision > 0),
        payload_json          TEXT NOT NULL
          CHECK (
            CASE
              WHEN json_valid(payload_json) = 1 THEN json_type(payload_json) = 'object'
              ELSE 0
            END
          ),
        payload_sha256        TEXT NOT NULL
          CHECK (
            length(payload_sha256) = 64
            AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
          ),
        supersedes_record_id  TEXT,
        created_at            TEXT NOT NULL
          CHECK (length(trim(created_at)) > 0),
        created_by_kind       TEXT NOT NULL
          CHECK (length(trim(created_by_kind)) > 0),
        created_by_id         TEXT NOT NULL
          CHECK (length(trim(created_by_id)) > 0),
        UNIQUE (project_id, contract_id, entity_id, entity_revision),
        UNIQUE (project_id, record_id),
        CHECK (
          supersedes_record_id IS NULL
          OR supersedes_record_id <> record_id
        ),
        FOREIGN KEY (project_id)
          REFERENCES materials_projects(project_id)
          ON UPDATE RESTRICT
          ON DELETE RESTRICT,
        FOREIGN KEY (project_id, supersedes_record_id)
          REFERENCES materials_object_versions(project_id, record_id)
          ON UPDATE RESTRICT
          ON DELETE RESTRICT
      );

      CREATE INDEX idx_materials_object_versions_history
        ON materials_object_versions(project_id, contract_id, entity_id, entity_revision DESC);

      CREATE INDEX idx_materials_object_versions_predecessor
        ON materials_object_versions(project_id, supersedes_record_id)
        WHERE supersedes_record_id IS NOT NULL;

      CREATE INDEX idx_materials_object_versions_payload_sha256
        ON materials_object_versions(payload_sha256);

      CREATE TRIGGER materials_object_versions_no_update
      BEFORE UPDATE ON materials_object_versions
      BEGIN
        SELECT RAISE(ABORT, 'materials_object_versions is append-only');
      END;

      CREATE TRIGGER materials_object_versions_no_delete
      BEFORE DELETE ON materials_object_versions
      BEGIN
        SELECT RAISE(ABORT, 'materials_object_versions is append-only');
      END;
    `)
  }
}
