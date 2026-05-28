-- CodeGps L4 global schema: cross-project registry + concept links

CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);
INSERT OR IGNORE INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial global schema');

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

CREATE TABLE IF NOT EXISTS concepts_global (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    local_concept_id TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    domain TEXT,
    embedding BLOB,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cg_project ON concepts_global(project_id);
CREATE INDEX IF NOT EXISTS idx_cg_domain ON concepts_global(domain);
CREATE INDEX IF NOT EXISTS idx_cg_name ON concepts_global(lower(name));

CREATE TABLE IF NOT EXISTS concept_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    a TEXT NOT NULL REFERENCES concepts_global(id) ON DELETE CASCADE,
    b TEXT NOT NULL REFERENCES concepts_global(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,    -- 'same_as' | 'variant_of' | 'supersedes' | 'contradicts'
    score REAL NOT NULL,
    source TEXT NOT NULL,  -- 'mechanical' | 'agent:linker'
    metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_link_a ON concept_links(a, kind);
CREATE INDEX IF NOT EXISTS idx_link_b ON concept_links(b, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_link_unique ON concept_links(a, b, kind, source);
