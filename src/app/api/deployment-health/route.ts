import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  let release = "unknown";

  try {
    release = readFileSync(
      join(process.cwd(), ".opc-release-id"),
      "utf8"
    ).trim();
  } catch {
    // Local development may not have a release marker.
  }

  return Response.json(
    { status: "ok", release },
    { headers: { "Cache-Control": "no-store" } }
  );
}
