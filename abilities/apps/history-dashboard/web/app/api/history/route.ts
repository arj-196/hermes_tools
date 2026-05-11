import { NextResponse } from "next/server";

import { getAllRunHistory, normalizeLookbackDays } from "../../../server/observability";

const DEFAULT_HISTORY_LIMIT = 500;

export async function GET(request: Request): Promise<NextResponse> {
  const rawLimit = (process.env.HISTORY_DASHBOARD_HISTORY_LIMIT ?? String(DEFAULT_HISTORY_LIMIT)).trim();
  const limit = Number.parseInt(rawLimit, 10);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_HISTORY_LIMIT;
  const searchParams = new URL(request.url).searchParams;
  const lookbackDays = normalizeLookbackDays(searchParams.get("lookbackDays"));
  const records = getAllRunHistory(safeLimit, lookbackDays);
  return NextResponse.json({ records, total: records.length });
}
