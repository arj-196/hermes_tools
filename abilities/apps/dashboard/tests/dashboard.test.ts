import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardPayload } from "../src/index.ts";

test("dashboard payload exposes the ability name", () => {
  const payload = buildDashboardPayload("status");
  assert.equal(payload.ability, "dashboard");
  assert.equal(payload.status, "ready");
});
