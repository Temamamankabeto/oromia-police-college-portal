import { readFileSync } from "node:fs";

const baseUrl = "http://127.0.0.1:3000";
const users = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

let passed = 0;
let failed = 0;

for (const user of users) {
  try {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": baseUrl,
      },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
      }),
    });

    const loginData = await login.json();

    if (
      login.status !== 200 ||
      !loginData.success ||
      loginData.user?.role_code !== user.role
    ) {
      throw new Error(
        `Login failed: HTTP ${login.status}, ${loginData.error || "Unexpected response"}`
      );
    }

    const cookie = login.headers
      .get("set-cookie")
      ?.split(";")[0];

    if (!cookie) {
      throw new Error("Session cookie missing");
    }

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });

    const meData = await me.json();

    if (
      me.status !== 200 ||
      meData.user?.email !== user.email ||
      meData.user?.role_code !== user.role
    ) {
      throw new Error("Session verification failed");
    }

    console.log(`PASS: ${user.role} login and session`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${user.role} — ${error.message}`);
    failed++;
  }
}

console.log("\n========== AUTHENTICATION TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}
