import { describe, expect, it, vi } from "vitest";

const { getAllRunHistory, normalizeLookbackDays } = vi.hoisted(() => ({
  getAllRunHistory: vi.fn(() => []),
  normalizeLookbackDays: vi.fn(() => 7),
}));

vi.mock("../../../server/observability", () => ({
  getAllRunHistory,
  normalizeLookbackDays,
}));

import { GET } from "./route";

describe("GET /api/history", () => {
  it("passes the lookbackDays query parameter through normalization before loading history", async () => {
    const response = await GET(new Request("http://localhost:3000/api/history?lookbackDays=30"));

    expect(response.status).toBe(200);
    expect(normalizeLookbackDays).toHaveBeenCalledWith("30");
    expect(getAllRunHistory).toHaveBeenCalledWith(500, 7);
  });
});
