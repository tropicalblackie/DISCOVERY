const { test, expect } = require('@playwright/test');

async function fillRequiredData(page) {
  await page.locator('#f_indirizzo').fill('Via Test QA 12');
  await page.locator('#f_citta').fill('Milano');
  await page.locator('#f_mq_bp').fill('5200');
  await page.locator('#f_mq_micro').fill('4800');

  const rows = page.locator('#cantieri-tbody tr');
  await rows.nth(0).locator('.c_nome').fill('Cantiere A');
  await rows.nth(0).locator('.c_addr').fill('Via Torino 1, Milano');
  await rows.nth(0).locator('.c_mq').fill('5000');

  await rows.nth(1).locator('.c_nome').fill('Cantiere B');
  await rows.nth(1).locator('.c_addr').fill('Via Torino 2, Milano');
  await rows.nth(1).locator('.c_mq').fill('5100');

  const ipotesi = page.locator('#ipotesi-container .ipotesi-editor');
  await ipotesi.nth(0).locator('.ip_title').fill('Ipotesi A');
  await ipotesi.nth(0).locator('.ip_body').fill('Corpo ipotesi A');

  await ipotesi.nth(1).locator('.ip_title').fill('Ipotesi B');
  await ipotesi.nth(1).locator('.ip_body').fill('Corpo ipotesi B');
}

test.describe('Discovery closure pack', () => {
  test('single-column layout with no right live panel', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#live-panel')).toHaveCount(0);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });

    expect(hasHorizontalOverflow).toBeFalsy();
  });

  test('quality block is after decision section', async ({ page }) => {
    await page.goto('/');

    const isAfter = await page.evaluate(() => {
      const decision = document.getElementById('d_next');
      const quality = document.getElementById('quality-strip');
      if (!decision || !quality) return false;
      return (decision.compareDocumentPosition(quality) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });

    expect(isAfter).toBeTruthy();
  });

  test('can generate A4 document with valid minimum data', async ({ page }) => {
    await page.goto('/');
    await fillRequiredData(page);

    await page.getByRole('button', { name: 'Genera documento A4' }).click();
    await expect(page.locator('#doc-output')).toBeVisible();
    await expect(page.locator('#doc-page .doc-section')).toHaveCount(6);
  });

  test('form state persists after reload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#f_indirizzo').fill('Via Persistenza 99');
    await page.reload();
    await expect(page.locator('#f_indirizzo')).toHaveValue('Via Persistenza 99');
  });

  test('metric controls use simplified labels and keep full structure', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('label', { hasText: 'Rating mercato' }).first()).toBeVisible();
    await expect(page.locator('label', { hasText: 'Rating mercato — stato' })).toBeVisible();
    await expect(page.locator('label', { hasText: 'Rating mercato — nota' })).toBeVisible();

    await expect(page.getByText('titolo sintetico')).toHaveCount(0);
    await expect(page.getByText('— colore')).toHaveCount(0);
    await expect(page.getByText('— sintesi')).toHaveCount(0);
  });
});
