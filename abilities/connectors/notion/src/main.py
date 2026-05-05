from __future__ import annotations

import json
import os
import sys


def mask_secret(value: str | None) -> str:
    if not value:
        return "missing"
    if len(value) <= 6:
        return "***"
    return f"{value[:3]}...{value[-3:]}"


def build_status_payload(mode: str) -> dict[str, object]:
    token = os.getenv("NOTION_API_TOKEN")
    parent_page = os.getenv("NOTION_PARENT_PAGE_ID")
    return {
        "ability": "notion",
        "mode": mode,
        "connected": bool(token and parent_page),
        "workspace": {
            "parent_page_id": parent_page or "missing",
            "token_preview": mask_secret(token),
        },
    }


def main(argv: list[str] | None = None) -> int:
    args = argv or sys.argv[1:]
    mode = args[0] if args else "invoke"
    if mode not in {"dev", "invoke"}:
        print(f"Unsupported mode: {mode}", file=sys.stderr)
        return 1

    print(json.dumps(build_status_payload(mode), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
