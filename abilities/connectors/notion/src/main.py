from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib import error, request

import typer

NOTION_VERSION = "2022-06-28"
NOTION_BASE_URL = "https://api.notion.com/v1"

app = typer.Typer(help="Direct CLI for the Hermes Notion connector.", no_args_is_help=True)


class NotionAPIError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class InvalidRequestError(ValueError):
    def __init__(self, action: str, message: str) -> None:
        super().__init__(message)
        self.action = action


def mask_secret(value: str | None) -> str:
    if not value:
        return "missing"
    if len(value) <= 6:
        return "***"
    return f"{value[:3]}...{value[-3:]}"


def build_status_payload() -> dict[str, object]:
    token = os.getenv("NOTION_API_TOKEN")
    parent_page = os.getenv("NOTION_PARENT_PAGE_ID")
    return {
        "ability": "notion",
        "connected": bool(token),
        "workspace": {
            "parent_page_id": parent_page or "missing",
            "token_preview": mask_secret(token),
        },
    }


def build_error(action: str, code: str, message: str, status: int = 400) -> dict[str, Any]:
    return {
        "ok": False,
        "action": action,
        "error": {
            "code": code,
            "message": message,
            "status": status,
        },
    }


def notion_request(
    method: str,
    path: str,
    token: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{NOTION_BASE_URL}{path}"
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = request.Request(url=url, method=method, data=body)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")

    try:
        with request.urlopen(req, timeout=30) as response:
            data = response.read().decode("utf-8")
            return json.loads(data) if data else {}
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {}

        raise NotionAPIError(
            status=exc.code,
            code=str(parsed.get("code") or "http_error"),
            message=str(parsed.get("message") or raw or "Notion API request failed"),
        ) from exc
    except error.URLError as exc:
        raise NotionAPIError(status=503, code="network_error", message=str(exc.reason)) from exc


def extract_page_summary(page: dict[str, Any], property_ids: list[str] | None = None) -> dict[str, Any]:
    title = ""
    for prop in page.get("properties", {}).values():
        if isinstance(prop, dict) and prop.get("type") == "title":
            fragments = prop.get("title", [])
            if isinstance(fragments, list):
                title = "".join(
                    frag.get("plain_text", "") for frag in fragments if isinstance(frag, dict)
                )
            break

    selected: dict[str, Any] = {}
    properties = page.get("properties", {})
    if isinstance(properties, dict):
        for prop in properties.values():
            if not isinstance(prop, dict):
                continue
            prop_id = prop.get("id")
            if property_ids and prop_id not in property_ids:
                continue
            if prop_id:
                selected[str(prop_id)] = prop

    return {
        "id": page.get("id"),
        "title": title,
        "last_edited_time": page.get("last_edited_time"),
        "properties": selected,
    }


def page_belongs_to_database(page: dict[str, Any], database_id: str) -> bool:
    parent = page.get("parent", {})
    if not isinstance(parent, dict):
        return False
    return parent.get("type") == "database_id" and parent.get("database_id") == database_id


def require_token(action: str) -> str:
    token = os.getenv("NOTION_API_TOKEN", "").strip()
    if not token:
        raise NotionAPIError(
            status=400,
            code="missing_token",
            message=f"NOTION_API_TOKEN is required for {action}.",
        )
    return token


def load_json_file(path: Path, action: str) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise InvalidRequestError(action, f"JSON file not found: {path}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidRequestError(action, f"Invalid JSON in {path}: {exc.msg}") from exc

    if not isinstance(payload, dict) or not payload:
        raise InvalidRequestError(action, f"{path} must contain a non-empty JSON object")
    return payload


def list_pages(
    token: str,
    database_id: str,
    mode: str = "summary",
    page_size: int | None = None,
    start_cursor: str | None = None,
    property_ids: list[str] | None = None,
) -> dict[str, Any]:
    action = "list_pages"
    if mode not in {"summary", "full"}:
        raise InvalidRequestError(action, "'mode' must be 'summary' or 'full'")
    if page_size is not None and page_size <= 0:
        raise InvalidRequestError(action, "'page_size' must be a positive integer")
    if start_cursor is not None and not start_cursor.strip():
        raise InvalidRequestError(action, "'start_cursor' must be a non-empty string")
    if property_ids is not None and any(not item.strip() for item in property_ids):
        raise InvalidRequestError(action, "'property_ids' must not contain empty values")

    request_payload: dict[str, Any] = {}
    if page_size is not None:
        request_payload["page_size"] = page_size
    if start_cursor is not None:
        request_payload["start_cursor"] = start_cursor

    api_response = notion_request("POST", f"/databases/{database_id}/query", token, request_payload)
    results = api_response.get("results", [])
    if not isinstance(results, list):
        raise NotionAPIError(status=502, code="invalid_response", message="Notion returned invalid list")

    output_results: list[Any]
    if mode == "full":
        output_results = results
    else:
        output_results = [extract_page_summary(page, property_ids) for page in results]

    return {
        "ok": True,
        "action": action,
        "data": {
            "results": output_results,
            "has_more": bool(api_response.get("has_more", False)),
            "next_cursor": api_response.get("next_cursor"),
        },
    }


def update_page_property(
    token: str,
    database_id: str,
    page_id: str,
    property_id: str,
    value: dict[str, Any],
) -> dict[str, Any]:
    action = "update_page_property"
    if not value:
        raise InvalidRequestError(action, "'value' must be a non-empty JSON object")

    page = notion_request("GET", f"/pages/{page_id}", token)
    if not page_belongs_to_database(page, database_id):
        raise NotionAPIError(
            status=400,
            code="database_mismatch",
            message="Page does not belong to the provided database_id",
        )

    update_payload = {"properties": {property_id: value}}
    updated_page = notion_request("PATCH", f"/pages/{page_id}", token, update_payload)

    return {
        "ok": True,
        "action": action,
        "data": {
            "page_id": updated_page.get("id"),
            "last_edited_time": updated_page.get("last_edited_time"),
            "updated_property": {
                "property_id": property_id,
                "value": updated_page.get("properties", {}).get(property_id, value),
            },
        },
    }


def emit_json(payload: dict[str, Any]) -> None:
    typer.echo(json.dumps(payload, indent=2))


def emit_human_status(payload: dict[str, Any]) -> None:
    workspace = payload["workspace"]
    typer.echo("Notion connector status")
    typer.echo(f"Connected: {'yes' if payload['connected'] else 'no'}")
    typer.echo(f"Token: {workspace['token_preview']}")
    typer.echo(f"Parent page: {workspace['parent_page_id']}")


def emit_human_list(payload: dict[str, Any], mode: str) -> None:
    results = payload["data"]["results"]
    typer.echo(f"Found {len(results)} database page(s) in {mode} mode")
    for page in results:
        if mode == "full":
            title = extract_page_summary(page).get("title") or "untitled"
            page_id = page.get("id", "unknown")
        else:
            title = page.get("title") or "untitled"
            page_id = page.get("id", "unknown")
        typer.echo(f"- {title} [{page_id}]")
    typer.echo(f"Has more: {'yes' if payload['data']['has_more'] else 'no'}")
    next_cursor = payload["data"]["next_cursor"]
    if next_cursor:
        typer.echo(f"Next cursor: {next_cursor}")


def emit_human_update(payload: dict[str, Any]) -> None:
    data = payload["data"]
    typer.echo(f"Updated property {data['updated_property']['property_id']} on page {data['page_id']}")
    typer.echo(f"Last edited: {data['last_edited_time']}")


def exit_with_error(action: str, exc: Exception, json_output: bool) -> None:
    if isinstance(exc, NotionAPIError):
        payload = build_error(action, exc.code, exc.message, exc.status)
    elif isinstance(exc, InvalidRequestError):
        payload = build_error(exc.action, "invalid_request", str(exc), 400)
    else:
        payload = build_error(action, "invalid_request", str(exc), 400)

    if json_output:
        emit_json(payload)
    else:
        typer.echo(f"{payload['error']['code']}: {payload['error']['message']}", err=True)
    raise typer.Exit(code=1)


@app.command("status")
def status(json_output: bool = typer.Option(False, "--json", help="Emit structured JSON.")) -> None:
    payload = build_status_payload()
    if json_output:
        emit_json(payload)
        return
    emit_human_status(payload)


@app.command("list-pages")
def list_pages_command(
    database_id: str = typer.Option(..., "--database-id", help="Target Notion database ID."),
    mode: str = typer.Option("summary", "--mode", help="summary or full."),
    page_size: int | None = typer.Option(None, "--page-size", help="Limit the number of results."),
    start_cursor: str | None = typer.Option(None, "--start-cursor", help="Pagination cursor."),
    property_ids: list[str] | None = typer.Option(None, "--property-id", help="Property ID to include in summary output. Repeat for multiple values."),
    json_output: bool = typer.Option(False, "--json", help="Emit structured JSON."),
) -> None:
    try:
        payload = list_pages(
            token=require_token("list-pages"),
            database_id=database_id,
            mode=mode,
            page_size=page_size,
            start_cursor=start_cursor,
            property_ids=property_ids,
        )
    except (InvalidRequestError, NotionAPIError) as exc:
        exit_with_error("list_pages", exc, json_output)

    if json_output:
        emit_json(payload)
        return
    emit_human_list(payload, mode)


@app.command("update-page-property")
def update_page_property_command(
    database_id: str = typer.Option(..., "--database-id", help="Target Notion database ID."),
    page_id: str = typer.Option(..., "--page-id", help="Target page ID."),
    property_id: str = typer.Option(..., "--property-id", help="Property ID to update."),
    value_file: Path = typer.Option(..., "--value-file", exists=True, dir_okay=False, readable=True, help="Path to a JSON file containing the Notion property payload."),
    json_output: bool = typer.Option(False, "--json", help="Emit structured JSON."),
) -> None:
    try:
        payload = update_page_property(
            token=require_token("update-page-property"),
            database_id=database_id,
            page_id=page_id,
            property_id=property_id,
            value=load_json_file(value_file, "update_page_property"),
        )
    except (InvalidRequestError, NotionAPIError) as exc:
        exit_with_error("update_page_property", exc, json_output)

    if json_output:
        emit_json(payload)
        return
    emit_human_update(payload)


if __name__ == "__main__":
    app(prog_name="notion")
