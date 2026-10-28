import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const baseURL = "http://127.0.0.1:3000";

const credentials = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const accounts = Array.isArray(credentials)
  ? credentials
  : Object.values(credentials);

const roles = [
  {
    email: "admin.test@opc.example",
    allowed: [
      "/dashboard", "/modules", "/reviews",
      "/approvals", "/users", "/reports", "/audit",
    ],
  },
  {
    email: "reviewer.test@opc.example",
    allowed: [
      "/dashboard", "/modules", "/reviews", "/reports",
    ],
  },
  {
    email: "approver.test@opc.example",
    allowed: [
      "/dashboard", "/modules", "/reviews",
      "/approvals", "/reports",
    ],
  },
];

async function authenticate(page, account) {
  const response = await page.request.post(
    `${baseURL}/api/auth/login`,
    {
      data: {
        email: account.email,
        password: account.password,
      },
      headers: {
        Origin: baseURL,
      },
    }
  );

  expect(response.status()).toBe(200);
}

test("Unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto(`${baseURL}/dashboard`);

  await expect(page).toHaveURL(/\/login/);
});

for (const role of roles) {
  test(`${role.email}: permitted pages render`, async ({ page }) => {
    const account = accounts.find(
      user => user.email === role.email
    );

    expect(account).toBeTruthy();

    await authenticate(page, account);

    for (const path of role.allowed) {
      const response = await page.goto(`${baseURL}${path}`, {
        waitUntil: "domcontentloaded",
      });

      expect(response?.status(), `${path} HTTP status`).toBe(200);

      await expect(page.locator("body")).not.toBeEmpty();

      await expect(page).not.toHaveURL(/\/login/);

      console.log(`PASS: ${role.email} -> ${path}`);
    }
  });
}

test("Reviewer cannot open administrator pages", async ({ page }) => {
  const account = accounts.find(
    user => user.email === "reviewer.test@opc.example"
  );

  await authenticate(page, account);

  for (const path of ["/users", "/audit", "/approvals"]) {
    await page.goto(`${baseURL}${path}`);

    const currentPath = new URL(page.url()).pathname;

    expect(
      currentPath !== path,
      `Reviewer should not remain on ${path}`
    ).toBeTruthy();
  }
});

test("Approver cannot open administrator pages", async ({ page }) => {
  const account = accounts.find(
    user => user.email === "approver.test@opc.example"
  );

  await authenticate(page, account);

  for (const path of ["/users", "/audit"]) {
    await page.goto(`${baseURL}${path}`);

    const currentPath = new URL(page.url()).pathname;

    expect(
      currentPath !== path,
      `Approver should not remain on ${path}`
    ).toBeTruthy();
  }
});

test("Approver can view reviews but cannot start a review", async ({ page }) => {
  const account = accounts.find(
    user => user.email === "approver.test@opc.example"
  );

  expect(account).toBeTruthy();

  await authenticate(page, account);

  await page.goto(`${baseURL}/reviews`);

  await expect(
    page.getByRole("heading", { name: "Proposal Reviews" })
  ).toBeVisible();

  const response = await page.request.post(
    `${baseURL}/api/reviews/999999999/start`,
    {
      data: {},
      headers: {
        Origin: baseURL,
      },
    }
  );

  expect(
    [401, 403],
    `Expected authorization rejection, received HTTP ${response.status()}`
  ).toContain(response.status());

  console.log("PASS: Approver can view reviews");
  console.log("PASS: Approver cannot start review workflow");
});
