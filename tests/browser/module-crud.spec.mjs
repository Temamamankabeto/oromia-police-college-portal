import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:3000";

const credentials = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const accounts = Array.isArray(credentials)
  ? credentials
  : Object.values(credentials);

test("ADMIN creates and deletes a module through the UI", async ({ page }) => {
  const db = new URL(process.env.DATABASE_URL || "");

  expect(db.hostname).toBe("127.0.0.1");
  expect(db.pathname).toBe("/opc_test_db");

  const admin = accounts.find(
    user => user.email === "admin.test@opc.example"
  );

  expect(admin).toBeTruthy();

  const login = await page.request.post(`${base}/api/auth/login`, {
    data: {
      email: admin.email,
      password: admin.password,
    },
    headers: { Origin: base },
  });

  expect(login.status()).toBe(200);

  await page.goto(`${base}/modules`);

  const code = `UI${Date.now().toString(36).toUpperCase()}`;
  const title = `Browser CRUD Test ${code}`;

  await page.getByRole("button", {
    name: /add module/i,
  }).click();

  const form = page.locator("main form");

  await form.getByPlaceholder("e.g. MOD001").fill(code);

  await form.getByPlaceholder(
    "Enter institutional module name"
  ).fill(title);

  await form.getByPlaceholder("Describe the module").fill(
    "Temporary module created by Playwright browser testing."
  );

  await form.getByRole("button", {
    name: "Save Module",
  }).click();

  const search = page.getByRole("textbox", {
    name: "Search modules",
  });

  await search.fill(code);

  const moduleRow = page.getByRole("row").filter({
    hasText: code,
  });

  await expect(moduleRow).toBeVisible();

  console.log("PASS: Module created through browser");

  page.once("dialog", async dialog => {
    await dialog.accept();
  });

  await moduleRow.getByRole("button", {
    name: "Delete",
  }).click();

  await expect(moduleRow).toHaveCount(0);

  console.log("PASS: Module deleted through browser");
});
