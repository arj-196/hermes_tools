from __future__ import annotations

import unittest

from abilities.connectors.notion.src.main import build_status_payload, mask_secret


class NotionAbilityTests(unittest.TestCase):
    def test_mask_secret_handles_missing_value(self) -> None:
        self.assertEqual(mask_secret(None), "missing")

    def test_status_payload_exposes_ability_name(self) -> None:
        payload = build_status_payload("invoke")
        self.assertEqual(payload["ability"], "notion")


if __name__ == "__main__":
    unittest.main()
