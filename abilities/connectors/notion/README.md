# Notion Connector Ability

This ability exposes Notion as a direct `Typer` CLI for Hermes.

## Prerequisites

Set these in your root `.env`:

```bash
NOTION_API_TOKEN=secret_...
NOTION_PARENT_PAGE_ID=optional-legacy-value
```

`NOTION_API_TOKEN` is required for API-backed commands.

## Commands

```bash
./bin/notion --help
./bin/notion status
./bin/notion list-pages --database-id your-database-id
./bin/notion list-pages --database-id your-database-id --mode full --json
./bin/notion update-page-property \
  --database-id your-database-id \
  --page-id your-page-id \
  --property-id status-id \
  --value-file ./property-value.json
```

If `bin/` is on your `PATH`, you can run `notion ...` directly.

## Output Modes

- Default output is human-readable terminal text.
- Add `--json` to `status`, `list-pages`, or `update-page-property` for structured output.

## Property Update Payloads

`update-page-property` expects a JSON file containing the raw Notion property
payload.

Example `property-value.json`:

```json
{
  "status": { "name": "In Progress" }
}
```

## Notes

- In this repo, a record or row in a Notion database is called a **database page**.
- `list-pages` supports repeated `--property-id` flags when you want filtered summary output.
