-- Artifact ledger schema for Azure SQL.
-- Stores full JSON artifacts and version history outside the live Cosmos graph.
-- ProcessGraph records should carry artifact_refs that point back to these rows.

CREATE TABLE dbo.graph_artifact (
    tenant_id           nvarchar(128)  NOT NULL,
    graph_id            nvarchar(256)  NOT NULL,
    artifact_id         nvarchar(256)  NOT NULL,
    artifact_type       nvarchar(64)   NOT NULL,
    source_format       nvarchar(64)   NOT NULL,
    name                nvarchar(512)  NOT NULL,
    source_file_name    nvarchar(512)  NULL,
    round_trip_role     nvarchar(64)   NOT NULL CONSTRAINT DF_graph_artifact_round_trip_role DEFAULT ('source'),
    storage_location    nvarchar(128)  NOT NULL CONSTRAINT DF_graph_artifact_storage_location DEFAULT ('azure_sql'),
    current_version_id  nvarchar(256)  NULL,
    summary_json        nvarchar(max)  NULL,
    created_at          datetime2(7)   NOT NULL CONSTRAINT DF_graph_artifact_created_at DEFAULT (sysutcdatetime()),
    updated_at          datetime2(7)   NOT NULL CONSTRAINT DF_graph_artifact_updated_at DEFAULT (sysutcdatetime()),
    created_by          nvarchar(256)  NULL,
    CONSTRAINT PK_graph_artifact PRIMARY KEY (tenant_id, graph_id, artifact_id),
    CONSTRAINT CK_graph_artifact_summary_json CHECK (summary_json IS NULL OR ISJSON(summary_json) = 1)
);

CREATE TABLE dbo.artifact_version (
    tenant_id            nvarchar(128)  NOT NULL,
    graph_id             nvarchar(256)  NOT NULL,
    artifact_id          nvarchar(256)  NOT NULL,
    version_id           nvarchar(256)  NOT NULL,
    parent_version_id    nvarchar(256)  NULL,
    content_json         nvarchar(max)  NOT NULL,
    content_sha256       char(64)       NOT NULL,
    content_bytes        bigint         NOT NULL,
    metadata_json        nvarchar(max)  NULL,
    validation_json      nvarchar(max)  NULL,
    llm_edit_session_id  nvarchar(256)  NULL,
    created_at           datetime2(7)   NOT NULL CONSTRAINT DF_artifact_version_created_at DEFAULT (sysutcdatetime()),
    created_by           nvarchar(256)  NULL,
    CONSTRAINT PK_artifact_version PRIMARY KEY (tenant_id, graph_id, artifact_id, version_id),
    CONSTRAINT FK_artifact_version_artifact FOREIGN KEY (tenant_id, graph_id, artifact_id)
        REFERENCES dbo.graph_artifact (tenant_id, graph_id, artifact_id),
    CONSTRAINT CK_artifact_version_content_json CHECK (ISJSON(content_json) = 1),
    CONSTRAINT CK_artifact_version_metadata_json CHECK (metadata_json IS NULL OR ISJSON(metadata_json) = 1),
    CONSTRAINT CK_artifact_version_validation_json CHECK (validation_json IS NULL OR ISJSON(validation_json) = 1)
);

CREATE TABLE dbo.artifact_validation (
    tenant_id       nvarchar(128)  NOT NULL,
    graph_id        nvarchar(256)  NOT NULL,
    artifact_id     nvarchar(256)  NOT NULL,
    version_id      nvarchar(256)  NOT NULL,
    validation_id   nvarchar(256)  NOT NULL,
    validator       nvarchar(128)  NOT NULL,
    status          nvarchar(64)   NOT NULL,
    report_json     nvarchar(max)  NOT NULL,
    created_at      datetime2(7)   NOT NULL CONSTRAINT DF_artifact_validation_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_artifact_validation PRIMARY KEY (tenant_id, graph_id, artifact_id, version_id, validation_id),
    CONSTRAINT FK_artifact_validation_version FOREIGN KEY (tenant_id, graph_id, artifact_id, version_id)
        REFERENCES dbo.artifact_version (tenant_id, graph_id, artifact_id, version_id),
    CONSTRAINT CK_artifact_validation_report_json CHECK (ISJSON(report_json) = 1)
);

CREATE TABLE dbo.llm_edit_session (
    tenant_id              nvarchar(128)  NOT NULL,
    graph_id               nvarchar(256)  NOT NULL,
    llm_edit_session_id    nvarchar(256)  NOT NULL,
    source_artifact_id     nvarchar(256)  NULL,
    source_version_id      nvarchar(256)  NULL,
    result_artifact_id     nvarchar(256)  NULL,
    result_version_id      nvarchar(256)  NULL,
    model                  nvarchar(128)  NULL,
    prompt_version         nvarchar(128)  NULL,
    request_json           nvarchar(max)  NULL,
    response_json          nvarchar(max)  NULL,
    diff_json              nvarchar(max)  NULL,
    status                 nvarchar(64)   NOT NULL,
    created_at             datetime2(7)   NOT NULL CONSTRAINT DF_llm_edit_session_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_llm_edit_session PRIMARY KEY (tenant_id, graph_id, llm_edit_session_id),
    CONSTRAINT CK_llm_edit_session_request_json CHECK (request_json IS NULL OR ISJSON(request_json) = 1),
    CONSTRAINT CK_llm_edit_session_response_json CHECK (response_json IS NULL OR ISJSON(response_json) = 1),
    CONSTRAINT CK_llm_edit_session_diff_json CHECK (diff_json IS NULL OR ISJSON(diff_json) = 1)
);

CREATE INDEX IX_graph_artifact_graph_format
    ON dbo.graph_artifact (tenant_id, graph_id, source_format, round_trip_role);

CREATE INDEX IX_artifact_version_artifact_created
    ON dbo.artifact_version (tenant_id, graph_id, artifact_id, created_at DESC);

CREATE INDEX IX_artifact_version_hash
    ON dbo.artifact_version (content_sha256);