from __future__ import annotations

import hashlib
import json
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

ARTIFACT_LEDGER_SCHEMA_VERSION = "artifact_ledger_v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def json_byte_size(value: Any) -> int:
    return len(canonical_json(value).encode("utf-8"))


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def artifact_id_for(payload: dict[str, Any]) -> str:
    explicit = payload.get("artifact_id") or payload.get("id")
    if explicit:
        return str(explicit)
    source_format = str(payload.get("source_format") or payload.get("format") or payload.get("artifact_type") or "artifact")
    return f"art_{source_format}_{uuid.uuid4().hex[:12]}"


def version_id() -> str:
    return f"artv_{uuid.uuid4().hex[:16]}"


def make_artifact_ref(record: dict[str, Any], version: dict[str, Any] | None = None) -> dict[str, Any]:
    version = version or record.get("current_version") or {}
    artifact_id = str(record.get("artifact_id") or record.get("id") or "")
    return {
        "id": artifact_id,
        "artifact_id": artifact_id,
        "artifact_type": str(record.get("artifact_type") or "external_json"),
        "source_format": str(record.get("source_format") or record.get("artifact_type") or "external_json"),
        "name": str(record.get("name") or record.get("source_file_name") or "Imported artifact"),
        "source_file_name": str(record.get("source_file_name") or ""),
        "hash": str(version.get("content_sha256") or record.get("hash") or ""),
        "bytes": version.get("content_bytes") if version.get("content_bytes") is not None else record.get("bytes"),
        "created_at": str(record.get("created_at") or version.get("created_at") or now()),
        "storage_location": str(record.get("storage_location") or "artifact_ledger"),
        "round_trip_role": str(record.get("round_trip_role") or "source"),
        "version_id": str(version.get("version_id") or record.get("current_version_id") or ""),
        "graph_id": str(record.get("graph_id") or ""),
        "summary": deepcopy(record.get("summary") if isinstance(record.get("summary"), dict) else {}),
    }


class ArtifactStore(Protocol):
    def save_artifact(self, tenant_id: str, graph_id: str, payload: dict[str, Any]) -> dict[str, Any]: ...

    def get_artifact(
        self,
        tenant_id: str,
        graph_id: str,
        artifact_id: str,
        version_id: str | None = None,
        include_content: bool = True,
    ) -> dict[str, Any] | None: ...

    def list_artifacts(self, tenant_id: str, graph_id: str) -> list[dict[str, Any]]: ...


class JsonFileArtifactStore:
    """Local artifact ledger for dev and tests.

    It intentionally stores full JSON content outside the ProcessGraph store so
    graph persistence can carry lightweight refs even when artifacts are large.
    Azure SQL should implement the same record/ref contract using the DDL in
    schema/artifact-ledger.sql.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schema_version": ARTIFACT_LEDGER_SCHEMA_VERSION, "tenants": {}}
        with self.path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        data.setdefault("schema_version", ARTIFACT_LEDGER_SCHEMA_VERSION)
        data.setdefault("tenants", {})
        return data

    def _save(self, store: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(store, handle, indent=2)

    def _graph_bucket(self, store: dict[str, Any], tenant_id: str, graph_id: str) -> dict[str, Any]:
        tenant = store.setdefault("tenants", {}).setdefault(tenant_id, {"graphs": {}})
        graph = tenant.setdefault("graphs", {}).setdefault(graph_id, {"artifacts": {}})
        graph.setdefault("artifacts", {})
        return graph

    def save_artifact(self, tenant_id: str, graph_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if "content" not in payload:
            raise ValueError("Artifact payload must include content")
        store = self._load()
        graph_bucket = self._graph_bucket(store, tenant_id, graph_id)
        artifacts = graph_bucket.setdefault("artifacts", {})
        artifact_id = artifact_id_for(payload)
        existing = artifacts.get(artifact_id, {})
        created_at = existing.get("created_at") or payload.get("created_at") or now()
        content = deepcopy(payload["content"])
        version = {
            "version_id": str(payload.get("version_id") or version_id()),
            "artifact_id": artifact_id,
            "tenant_id": tenant_id,
            "graph_id": graph_id,
            "content": content,
            "content_sha256": content_hash(content),
            "content_bytes": json_byte_size(content),
            "validation": deepcopy(payload.get("validation") if isinstance(payload.get("validation"), dict) else {}),
            "metadata": deepcopy(payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}),
            "created_at": now(),
            "created_by": str(payload.get("created_by") or ""),
            "parent_version_id": str(payload.get("parent_version_id") or existing.get("current_version_id") or ""),
            "llm_edit_session_id": str(payload.get("llm_edit_session_id") or ""),
        }
        record = {
            **existing,
            "artifact_id": artifact_id,
            "tenant_id": tenant_id,
            "graph_id": graph_id,
            "artifact_type": str(payload.get("artifact_type") or payload.get("type") or existing.get("artifact_type") or "external_json"),
            "source_format": str(payload.get("source_format") or payload.get("format") or existing.get("source_format") or "external_json"),
            "name": str(payload.get("name") or existing.get("name") or payload.get("source_file_name") or "Imported artifact"),
            "source_file_name": str(payload.get("source_file_name") or existing.get("source_file_name") or ""),
            "round_trip_role": str(payload.get("round_trip_role") or existing.get("round_trip_role") or "source"),
            "storage_location": str(payload.get("storage_location") or existing.get("storage_location") or "artifact_ledger"),
            "summary": deepcopy(payload.get("summary") if isinstance(payload.get("summary"), dict) else existing.get("summary", {})),
            "created_at": created_at,
            "updated_at": version["created_at"],
            "current_version_id": version["version_id"],
            "versions": list(existing.get("versions") or []),
        }
        record["versions"].append(version)
        artifacts[artifact_id] = record
        self._save(store)
        return self._public_artifact(record, version, include_content=False)

    def get_artifact(
        self,
        tenant_id: str,
        graph_id: str,
        artifact_id: str,
        version_id: str | None = None,
        include_content: bool = True,
    ) -> dict[str, Any] | None:
        tenant = self._load().get("tenants", {}).get(tenant_id)
        if not tenant:
            return None
        graph = tenant.get("graphs", {}).get(graph_id)
        if not graph:
            return None
        record = graph.get("artifacts", {}).get(artifact_id)
        if not record:
            return None
        version = self._select_version(record, version_id)
        if not version:
            return None
        return self._public_artifact(record, version, include_content=include_content)

    def list_artifacts(self, tenant_id: str, graph_id: str) -> list[dict[str, Any]]:
        tenant = self._load().get("tenants", {}).get(tenant_id)
        if not tenant:
            return []
        graph = tenant.get("graphs", {}).get(graph_id)
        if not graph:
            return []
        refs = []
        for record in graph.get("artifacts", {}).values():
            version = self._select_version(record, None)
            if version:
                refs.append(make_artifact_ref(record, version))
        return sorted(refs, key=lambda item: item.get("created_at", ""), reverse=True)

    def _select_version(self, record: dict[str, Any], wanted_version_id: str | None) -> dict[str, Any] | None:
        versions = record.get("versions") if isinstance(record.get("versions"), list) else []
        if wanted_version_id:
            return next((version for version in versions if version.get("version_id") == wanted_version_id), None)
        current = record.get("current_version_id")
        if current:
            found = next((version for version in versions if version.get("version_id") == current), None)
            if found:
                return found
        return versions[-1] if versions else None

    def _public_artifact(self, record: dict[str, Any], version: dict[str, Any], include_content: bool) -> dict[str, Any]:
        artifact_ref = make_artifact_ref(record, version)
        out = {
            "schema_version": ARTIFACT_LEDGER_SCHEMA_VERSION,
            "artifact_id": artifact_ref["artifact_id"],
            "version_id": artifact_ref["version_id"],
            "tenant_id": record.get("tenant_id", ""),
            "graph_id": record.get("graph_id", ""),
            "artifact_type": artifact_ref["artifact_type"],
            "source_format": artifact_ref["source_format"],
            "name": artifact_ref["name"],
            "source_file_name": artifact_ref["source_file_name"],
            "round_trip_role": artifact_ref["round_trip_role"],
            "storage_location": artifact_ref["storage_location"],
            "created_at": record.get("created_at", ""),
            "updated_at": record.get("updated_at", ""),
            "content_sha256": version.get("content_sha256", ""),
            "content_bytes": version.get("content_bytes"),
            "metadata": deepcopy(version.get("metadata") if isinstance(version.get("metadata"), dict) else {}),
            "summary": deepcopy(record.get("summary") if isinstance(record.get("summary"), dict) else {}),
            "validation": deepcopy(version.get("validation") if isinstance(version.get("validation"), dict) else {}),
            "artifact_ref": artifact_ref,
        }
        if include_content:
            out["content"] = deepcopy(version.get("content"))
        return out