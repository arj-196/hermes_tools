from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from abilities.connectors.notion.src import main


class NotionAbilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()

    def test_mask_secret_handles_missing_value(self) -> None:
        self.assertEqual(main.mask_secret(None), "missing")

    def test_status_payload_exposes_ability_name(self) -> None:
        payload = main.build_status_payload()
        self.assertEqual(payload["ability"], "notion")

    def test_list_pages_rejects_invalid_mode(self) -> None:
        with self.assertRaises(main.InvalidRequestError):
            main.list_pages("token", "db1", mode="bad-mode")

    @patch("abilities.connectors.notion.src.main.notion_request")
    def test_list_pages_summary_mode(self, mock_notion_request) -> None:
        mock_notion_request.return_value = {
            "results": [
                {
                    "id": "page-1",
                    "last_edited_time": "2026-05-05T12:00:00.000Z",
                    "properties": {
                        "Title": {
                            "id": "title",
                            "type": "title",
                            "title": [{"plain_text": "Task A"}],
                        },
                        "Status": {
                            "id": "status-id",
                            "type": "status",
                            "status": {"name": "Todo"},
                        },
                    },
                }
            ],
            "has_more": True,
            "next_cursor": "cursor-1",
        }

        response = main.list_pages("token", "db1", mode="summary", property_ids=["status-id"])

        self.assertTrue(response["ok"])
        self.assertEqual(response["action"], "list_pages")
        self.assertEqual(response["data"]["next_cursor"], "cursor-1")
        page = response["data"]["results"][0]
        self.assertEqual(page["id"], "page-1")
        self.assertEqual(page["title"], "Task A")
        self.assertEqual(sorted(page["properties"].keys()), ["status-id"])

    @patch("abilities.connectors.notion.src.main.notion_request")
    def test_list_pages_full_mode(self, mock_notion_request) -> None:
        raw_page = {"id": "page-raw", "properties": {"A": {"id": "a"}}}
        mock_notion_request.return_value = {
            "results": [raw_page],
            "has_more": False,
            "next_cursor": None,
        }

        response = main.list_pages("token", "db1", mode="full")

        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["results"][0], raw_page)

    @patch("abilities.connectors.notion.src.main.notion_request")
    def test_update_page_property_success(self, mock_notion_request) -> None:
        mock_notion_request.side_effect = [
            {
                "id": "page-1",
                "parent": {"type": "database_id", "database_id": "db1"},
            },
            {
                "id": "page-1",
                "last_edited_time": "2026-05-05T13:00:00.000Z",
                "properties": {
                    "status-id": {
                        "id": "status-id",
                        "type": "status",
                        "status": {"name": "Done"},
                    }
                },
            },
        ]

        response = main.update_page_property(
            "token",
            "db1",
            "page-1",
            "status-id",
            {"status": {"name": "Done"}},
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["action"], "update_page_property")
        self.assertEqual(response["data"]["page_id"], "page-1")
        self.assertEqual(response["data"]["updated_property"]["property_id"], "status-id")

    @patch("abilities.connectors.notion.src.main.notion_request")
    def test_update_page_rejects_database_mismatch(self, mock_notion_request) -> None:
        mock_notion_request.return_value = {
            "id": "page-1",
            "parent": {"type": "database_id", "database_id": "db-other"},
        }

        with self.assertRaises(main.NotionAPIError) as ctx:
            main.update_page_property(
                "token",
                "db1",
                "page-1",
                "status-id",
                {"status": {"name": "Done"}},
            )

        self.assertEqual(ctx.exception.code, "database_mismatch")

    def test_require_token_rejects_missing_env(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(main.NotionAPIError) as ctx:
                main.require_token("list-pages")
        self.assertEqual(ctx.exception.code, "missing_token")

    def test_status_cli_json(self) -> None:
        result = self.runner.invoke(main.app, ["status", "--json"])

        self.assertEqual(result.exit_code, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["ability"], "notion")

    @patch("abilities.connectors.notion.src.main.notion_request")
    def test_list_pages_cli_json(self, mock_notion_request) -> None:
        mock_notion_request.return_value = {"results": [], "has_more": False, "next_cursor": None}

        with patch.dict("os.environ", {"NOTION_API_TOKEN": "secret_test_token"}, clear=True):
            result = self.runner.invoke(
                main.app,
                ["list-pages", "--database-id", "db1", "--json"],
            )

        self.assertEqual(result.exit_code, 0)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["action"], "list_pages")

    @patch("abilities.connectors.notion.src.main.notion_request")
    def test_update_page_property_cli_json(self, mock_notion_request) -> None:
        mock_notion_request.side_effect = [
            {"id": "page-1", "parent": {"type": "database_id", "database_id": "db1"}},
            {
                "id": "page-1",
                "last_edited_time": "2026-05-05T13:00:00.000Z",
                "properties": {"status-id": {"status": {"name": "Done"}}},
            },
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            value_file = Path(tmpdir) / "value.json"
            value_file.write_text('{"status": {"name": "Done"}}', encoding="utf-8")
            with patch.dict("os.environ", {"NOTION_API_TOKEN": "secret_test_token"}, clear=True):
                result = self.runner.invoke(
                    main.app,
                    [
                        "update-page-property",
                        "--database-id",
                        "db1",
                        "--page-id",
                        "page-1",
                        "--property-id",
                        "status-id",
                        "--value-file",
                        str(value_file),
                        "--json",
                    ],
                )

        self.assertEqual(result.exit_code, 0)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data"]["page_id"], "page-1")

    def test_bin_help_invocation(self) -> None:
        result = self.runner.invoke(main.app, ["--help"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Direct CLI for the Hermes Notion connector", result.stdout)


if __name__ == "__main__":
    unittest.main()
