import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:3000";

const db = new URL(process.env.DATABASE_URL || "");

if (
  db.hostname !== "127.0.0.1" ||
  db.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test outside local test database");
}

const credentials = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const accounts = Array.isArray(credentials)
  ? credentials
  : Object.values(credentials);

async function login(page, email) {
  const account = accounts.find(user => user.email === email);
  expect(account).toBeTruthy();

  const response = await page.request.post(`${base}/api/auth/login`, {
    data: {
      email: account.email,
      password: account.password,
    },
    headers: { Origin: base },
  });

  expect(response.status()).toBe(200);
}

async function openReview(page, code) {
  await page.goto(`${base}/reviews`);

  await page.getByRole("textbox", {
    name: "Search proposals",
  }).fill(code);

  const row = page.getByRole("row").filter({
    hasText: code,
  });

  await expect(row).toBeVisible();

  await row.getByRole("button", {
    name: "View Details",
  }).click();

  await expect(
    page.getByRole("heading", {
      name: "Review Actions & Comments",
    })
  ).toBeVisible();
}

test("Complete proposal lifecycle: ADMIN → REVIEWER → APPROVER", async ({
  browser,
}) => {
  test.setTimeout(120000);

  const code = `E2E${Date.now().toString(36).toUpperCase()}`;
  const title = `E2E Proposal ${code}`;

  const adminContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const approverContext = await browser.newContext();

  const admin = await adminContext.newPage();
  const reviewer = await reviewerContext.newPage();
  const approver = await approverContext.newPage();

  try {
    await login(admin, "admin.test@opc.example");
    await login(reviewer, "reviewer.test@opc.example");
    await login(approver, "approver.test@opc.example");

    // 1. ADMIN CREATES PROPOSAL
    await admin.goto(`${base}/modules`);

    await admin.getByRole("button", {
      name: /add module/i,
    }).click();

    const form = admin.locator("main form");

    await form.getByPlaceholder("e.g. MOD001").fill(code);

    await form.getByPlaceholder(
      "Enter institutional module name"
    ).fill(title);

    await form.getByPlaceholder("Describe the module").fill(
      "End-to-end browser test proposal for Oromia Police College."
    );

    await form.getByRole("button", {
      name: "Save Module",
    }).click();

    await admin.getByRole("textbox", {
      name: "Search modules",
    }).fill(code);

    const moduleRow = admin.getByRole("row").filter({
      hasText: code,
    });

    await expect(moduleRow).toBeVisible();

    console.log("PASS 1: ADMIN created proposal");

    // 2. ADMIN CREATES ACTIVITY
    await moduleRow.getByRole("button", {
      name: "Activities",
    }).click();

    await admin.getByRole("button", {
      name: /add activity/i,
    }).click();

    await admin.getByPlaceholder("ACT-001").fill("ACT-001");

    await admin.getByRole("textbox", {
      name: "Activity Title *",
    }).fill("Prepare institutional implementation plan");

    await admin.getByRole("button", {
      name: "Save Activity",
    }).click();

    await expect(
      admin.getByText("Prepare institutional implementation plan")
    ).toBeVisible();

    console.log("PASS 2: ADMIN created proposal activity");

    // 3. REVIEWER STARTS REVIEW
    await openReview(reviewer, code);

    await reviewer.getByRole("button", {
      name: "Start Review",
    }).click();

    await expect(
      reviewer.getByRole("button", {
        name: "Add Comment",
      })
    ).toBeVisible();

    console.log("PASS 3: REVIEWER started review");

    // 4. REVIEWER ADDS COMMENT
    await reviewer.getByPlaceholder(
      "Enter your review comment"
    ).fill("Please improve the implementation plan.");

    await reviewer.getByRole("button", {
      name: "Add Comment",
    }).click();

    await expect(
      reviewer.getByText("Please improve the implementation plan.")
    ).toBeVisible();

    console.log("PASS 4: REVIEWER added comment");

    // 5. REVIEWER REQUESTS REVISION
    await reviewer.locator("#revision-remarks").fill(
      "Revise the institutional implementation plan."
    );

    await reviewer.getByRole("button", {
      name: "Request Revision",
    }).click();

    await expect(
      reviewer.locator("section").filter({
        has: reviewer.getByRole("heading", {
          name: "Review Actions & Comments",
        }),
      }).locator("p").filter({
        hasText: /Status:\s*Revision Requested/i,
      })
    ).toBeVisible();

    console.log("PASS 5: REVIEWER requested revision");

    // 6. ADMIN RESUBMITS PROPOSAL
    await openReview(admin, code);

    await admin.getByPlaceholder(
      "Describe the corrections made"
    ).fill(
      "Updated the implementation plan based on reviewer feedback."
    );

    await admin.getByRole("button", {
      name: "Resubmit Proposal",
    }).click();

    console.log("PASS 6: ADMIN resubmitted proposal");

    // 7. REVIEWER RESOLVES COMMENT
    await openReview(reviewer, code);

    await reviewer.getByRole("button", {
      name: "Resolved",
    }).click();

    await expect(
      reviewer.getByText("RESOLVED").first()
    ).toBeVisible();

    console.log("PASS 7: REVIEWER resolved comment");

    // 8. REVIEWER SUBMITS FOR APPROVAL
    await reviewer.getByRole("button", {
      name: "Submit for Approval",
    }).click();

    console.log("PASS 8: REVIEWER submitted for approval");

    // 9. APPROVER APPROVES
    await approver.goto(`${base}/approvals`);

    await approver.getByRole("button", {
      name: new RegExp(code),
    }).click();

    await approver.getByRole("combobox").selectOption("APPROVED");

    await approver.getByPlaceholder("Decision remarks").fill(
      "Proposal reviewed and approved."
    );

    await approver.getByRole("button", {
      name: "Submit Decision",
    }).click();

    await expect(
      approver.getByText("APPROVED").first()
    ).toBeVisible();

    console.log("PASS 9: APPROVER approved proposal");
    console.log(`FINAL APPROVED TEST PROPOSAL: ${code}`);

  } finally {
    await adminContext.close();
    await reviewerContext.close();
    await approverContext.close();
  }
});
