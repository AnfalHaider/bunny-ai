import { test, expect } from '@playwright/test';

// WEBAPP-SIGNIN: the sign-in page says why a sign-in did not work. The server answers are made up here (the real ones are in test/webapp-signin.test.js).
const answer = (status, json, headers = {}) => (route) => route.fulfill({ status, json, headers });

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 780 } });

    for (const [name, status, body, text] of [
      ['wrong passcode', 401, { code: 'remote.passcode', reason: 'passcode', message: 'That passcode is not right.' }, 'That passcode is not right.'],
      ['an address that changed', 403, { code: 'request.badHost', reason: 'address', message: 'This address is not the one Bunny is open on. It may have changed: open the address shown in Bunny on the computer.' }, 'It may have changed: open the address shown in Bunny on the computer.'],
      ['a page not from Bunny itself', 403, { code: 'request.badOrigin', reason: 'origin', message: "That request did not come from Bunny's own page. Open the address shown in Bunny on the computer and sign in there." }, 'sign in there.'],
    ]) {
      test(`${name}: the page shows the server's reason`, async ({ page }) => {
        await page.route('**/api/remote/signin', answer(status, body));
        await page.goto('/src/ui/signin.html');
        await page.fill('#passcode', 'whatever passcode here');
        await page.click('#go');
        await expect(page.locator('#msg')).toContainText(text);
        await expect(page.locator('#go')).toBeEnabled();
      });
    }

    test('an answer that is not Bunny (a proxy error) names its status, and an unreachable address says the address may have changed', async ({ page }) => {
      await page.route('**/api/remote/signin', (route) => route.fulfill({ status: 502, body: 'bad gateway' }));
      await page.goto('/src/ui/signin.html');
      await page.fill('#passcode', 'whatever passcode here');
      await page.click('#go');
      await expect(page.locator('#msg')).toContainText('the answer was 502');
      await page.unroute('**/api/remote/signin');
      await page.route('**/api/remote/signin', (route) => route.abort());
      await page.fill('#passcode', 'whatever passcode here');
      await page.click('#go');
      await expect(page.locator('#msg')).toContainText('If it has changed, open the address shown in Bunny on the computer.');
    });

    test('after a session ended, the sign-in page says so', async ({ page }) => {
      await page.goto('/src/ui/signin.html?signedout=1');
      await expect(page.locator('#msg')).toContainText('You were signed out');
    });
  });
}
