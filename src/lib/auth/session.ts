import "server-only";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "opc_session";

const SESSION_DURATION = 60 * 60 * 8;

function getSessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "SESSION_SECRET must contain at least 32 bytes"
    );
  }

  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  userId: string,
  sessionVersion: number
): Promise<string> {
  return new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .setIssuer("oromia-police-college-portal")
    .setAudience("oromia-police-college-portal")
    .sign(getSessionKey());
}

export async function verifySessionToken(
  token: string
): Promise<{ userId: string; sessionVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      getSessionKey(),
      {
        algorithms: ["HS256"],
        issuer: "oromia-police-college-portal",
        audience: "oromia-police-college-portal",
      }
    );

    if (
      !payload.sub ||
      typeof payload.sv !== "number" ||
      !Number.isSafeInteger(payload.sv) ||
      payload.sv < 1
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      sessionVersion: payload.sv,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DURATION,
};
