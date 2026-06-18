import { test, expect, type Page } from "playwright/test";

// real-browser coverage for enter-to-submit, which jsdom/vitest cannot
// exercise (jsdom does not implement implicit form submission). the backend
// is stubbed so the spec only needs the vite dev server.

const TOKEN_RESPONSE = {
  access_token: "test-token",
  user: {
    id: "u-1",
    email: "operator@example.com",
    name: "Operator",
    role: "OPERATOR",
    airports: [],
  },
};

async function stubAuth(page: Page) {
  // keep the spec hermetic: any other api call (post-login system-settings,
  // etc.) gets a benign 200 so nothing reaches a real backend. later routes
  // win in playwright, so the specific ones below take precedence.
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ status: 200, json: {} }),
  );
  // mount-time refresh has no cookie -> stay logged out on /login
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { detail: "no cookie" } }),
  );
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({ status: 200, json: TOKEN_RESPONSE }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubAuth(page);
  await page.goto("/login");
  await page.getByTestId("email-input").fill("operator@example.com");
  await page.getByTestId("password-input").fill("password123");
});

test("Enter in the password field submits the form and logs in", async ({ page }) => {
  await page.getByTestId("password-input").press("Enter");
  await expect(page).toHaveURL(/\/operator-center\//);
});

test("Enter in the email field submits the form and logs in", async ({ page }) => {
  await page.getByTestId("email-input").press("Enter");
  await expect(page).toHaveURL(/\/operator-center\//);
});

test("Enter posts the same credentials as clicking Login", async ({ page }) => {
  const [enterRequest] = await Promise.all([
    page.waitForRequest("**/api/v1/auth/login"),
    page.getByTestId("password-input").press("Enter"),
  ]);
  expect(enterRequest.postDataJSON()).toEqual({
    email: "operator@example.com",
    password: "password123",
  });
});
