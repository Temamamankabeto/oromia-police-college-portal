import "server-only";
import { createHmac } from "node:crypto";
import { query } from "@/lib/db";
import type { PoolClient } from "pg";

const WINDOW_SECONDS = 15 * 60;

type RateLimitRow = {
  attempt_count: number;
  blocked: boolean;
};

function getRateLimitSecret(): string {
  const secret = process.env.RATE_LIMIT_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "RATE_LIMIT_SECRET must contain at least 32 bytes"
    );
  }

  return secret;
}

export function rateLimitIdentifier(
  type: "account" | "ip",
  value: string
): string {
  const normalized = value.trim().toLowerCase();

  return createHmac("sha256", getRateLimitSecret())
    .update(`${type}:${normalized}`)
    .digest("hex");
}

export async function recordLoginAttempt(
  identifier: string,
  limit: number,
  client?: PoolClient
): Promise<boolean> {
  const execute = client
    ? client.query.bind(client)
    : query;

  const result = await execute<RateLimitRow>(
    `
    INSERT INTO login_rate_limits (
      identifier,
      attempt_count,
      window_started_at,
      blocked_until,
      updated_at
    )
    VALUES ($1, 1, NOW(), NULL, NOW())
    ON CONFLICT (identifier)
    DO UPDATE SET
      attempt_count = CASE
        WHEN login_rate_limits.window_started_at
          <= NOW() - ($3::integer * INTERVAL '1 second')
        THEN 1
        ELSE login_rate_limits.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN login_rate_limits.window_started_at
          <= NOW() - ($3::integer * INTERVAL '1 second')
        THEN NOW()
        ELSE login_rate_limits.window_started_at
      END,
      blocked_until = CASE
        WHEN login_rate_limits.window_started_at
          <= NOW() - ($3::integer * INTERVAL '1 second')
        THEN NULL
        WHEN login_rate_limits.attempt_count + 1 >= $2
        THEN login_rate_limits.window_started_at
          + ($3::integer * INTERVAL '1 second')
        ELSE login_rate_limits.blocked_until
      END,
      updated_at = NOW()
    RETURNING
      attempt_count,
      (blocked_until IS NOT NULL
        AND blocked_until > NOW()) AS blocked
    `,
    [identifier, limit, WINDOW_SECONDS]
  );

  return result.rows[0]?.blocked ?? false;
}

export async function isLoginBlocked(
  identifier: string,
  limit: number,
  client?: PoolClient
): Promise<boolean> {
  const execute = client
    ? client.query.bind(client)
    : query;

  const result = await execute<{ blocked: boolean }>(
    `
    SELECT
      (
        (
          blocked_until IS NOT NULL
          AND blocked_until > NOW()
        )
        OR (
          attempt_count >= $2
          AND window_started_at >
            NOW() - ($3::integer * INTERVAL '1 second')
        )
      ) AS blocked
    FROM login_rate_limits
    WHERE identifier = $1
    `,
    [identifier, limit, WINDOW_SECONDS]
  );

  return result.rows[0]?.blocked ?? false;
}
