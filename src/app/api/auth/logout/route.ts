import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expectedOrigin = "https://opc.osdavc.com";

  if (!origin || origin !== expectedOrigin) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request origin",
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const response = NextResponse.json(
    {
      success: true,
      message: "Logged out successfully",
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );

  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions,
    maxAge: 0,
  });

  return response;
}
