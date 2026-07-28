import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

// Survive HMR; coalesce rapid dashboard polls so the first cold probe (can be
// multi-second when headroom-ai is absent) is not re-run on every page load.
const STATUS_CACHE_TTL_MS = 10000;
const statusCache = (global.__headroomStatusCache ??= { value: null, fetchedAt: 0 });

export async function GET() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    let status = statusCache.value;
    if (!status || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
      status = await getHeadroomStatus(url);
      statusCache.value = status;
      statusCache.fetchedAt = Date.now();
    }
    const managedPid = getManagedPid();
    return NextResponse.json({ ...status, url, managedPid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
