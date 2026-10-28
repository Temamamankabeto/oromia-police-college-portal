import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:3000";
const code = "E2EMVR7F1KO";
const moduleId = "55";

const url = new URL(process.env.DATABASE_URL || "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing non-local test database");
}

const credentials = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const accounts = Array.isArray(credentials)
  ? credentials
  : Object.values(credentials);

async function login(page, email) {
  const account = accounts.find(a => a.email === email);
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

async function review(page) {
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
}

async function getStatus(page) {
  const response = await page.request.get(`${base}/api/reviews`);
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.success).toBe(true);

  const proposal = body.data.find(
    item => String(item.module_id) === moduleId
  );

  expect(proposal).toBeTruthy();
  return proposal;
}

test("Resume existing proposal through final approval", async ({
  browser,
}) => {
  test.setTimeout(120000);

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

    // ADMIN resubmits the existing revision.
    const initial = await getStatus(admin);

    if (initial.approval_status === "REVISION_REQUESTED") {
      await review(admin);

      await admin.getByPlaceholder(
        "Describe the corrections made"
      ).fill(
        "Implementation plan revised following reviewer feedback."
      );

      await admin.getByRole("button", {
        name: "Resubmit Proposal",
      }).click();
    }

    await expect.poll(async () => {
      return (await getStatus(admin)).approval_status;
    }).toBe("UNDER_REVIEW");

    console.log("PASS 6: ADMIN resubmitted proposal");

    // REVIEWER resolves the outstanding comment.
    await review(reviewer);

    const commentsResponse = await reviewer.request.get(
      `${base}/api/reviews/${moduleId}/comments`
    );

    expect(commentsResponse.ok()).toBeTruthy();

    const commentsBody = await commentsResponse.json();
    expect(commentsBody.success).toBe(true);

    const unresolved = commentsBody.data.filter(
      item => item.resolution_status !== "RESOLVED"
    );

    for (const comment of unresolved) {
      const response = await reviewer.request.patch(
        `${base}/api/reviews/${moduleId}/comments/${comment.id}/resolve`,
        {
          data: { resolution_status: "RESOLVED" },
          headers: { Origin: base },
        }
      );

      expect(response.ok()).toBeTruthy();
    }

    await expect.poll(async () => {
      return (await getStatus(reviewer)).unresolved_comment_count;
    }).toBe(0);

    console.log("PASS 7: REVIEWER resolved comments");

    // REVIEWER submits the proposal for approval.
    await reviewer.reload();

    await reviewer.getByRole("textbox", {
      name: "Search proposals",
    }).fill(code);

    await reviewer.getByRole("row").filter({
      hasText: code,
    }).getByRole("button", {
      name: "View Details",
    }).click();

    await reviewer.getByRole("button", {
      name: "Submit for Approval",
    }).click();

    await expect.poll(async () => {
      return (await getStatus(reviewer)).approval_status;
    }).toBe("READY_FOR_APPROVAL");

    console.log("PASS 8: REVIEWER submitted for approval");

    // APPROVER makes the final decision.
    await approver.goto(`${base}/approvals`);

    await approver.getByRole("button", {
      name: new RegExp(code),
    }).click();

    await approver.getByRole("combobox").selectOption("APPROVED");

    await approver.getByPlaceholder(
      "Decision remarks"
    ).fill("Approved after review and revision.");

    await approver.getByRole("button", {
      name: "Submit Decision",
    }).click();

    await expect.poll(async () => {
      return (await getStatus(approver)).approval_status;
    }).toBe("APPROVED");

    console.log("PASS 9: APPROVER approved proposal");
    console.log(`APPROVED: ${code} (ID ${moduleId})`);

  } finally {
    await adminContext.close();
    await reviewerContext.close();
    await approverContext.close();
  }
});
