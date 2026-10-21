import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS ?? 'test-results';
test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, permissions: ['geolocation'], geolocation: { latitude: 51.50165, longitude: -0.07067, accuracy: 9 } });

async function tapMap(page: Page, dx: number, dy: number) {
  const box = (await page.getByTestId('map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test('capture, refine, place from register, back up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await expect(page.locator('.badge')).toHaveText(/\d+/);
  const unplacedBefore = Number(await page.locator('.badge').textContent());
  await page.screenshot({ path: `${SHOTS}/01-home.png` });

  // New bird feeder at the GPS position, with a photo.
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.getByRole('button', { name: 'Bird feeder' }).click();
  await expect(page.getByText('GPS ±9m')).toBeVisible();
  await page.locator('#capture-photo').setInputFiles('tests/leaf.jpg');
  await expect(page.locator('.thumbs img')).toHaveCount(1);
  await page.fill('#capture-name', 'Feeder by the bench');
  await page.screenshot({ path: `${SHOTS}/02-capture.png` });
  await page.getByRole('button', { name: /Save here/ }).click();
  await expect(page.locator('.panel-head h2')).toHaveText('Feeder by the bench');
  await expect(page.locator('.panel-sub .chip')).toHaveText('Rough ±9m');
  await expect(page.locator('.thumbs-strip .thumb')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/03-feature.png` });

  // Refine by dragging the handle.
  await page.getByRole('button', { name: 'Refine position' }).click();
  const h = page.locator('.handle-point');
  await expect(h).toBeVisible();
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save position' }).click();
  await expect(page.locator('.panel-sub .chip')).toHaveText('Placed');
  await page.getByRole('button', { name: 'Close panel' }).click();

  // Place Roadside Bed East from the register by tracing it.
  await page.getByRole('button', { name: /Register/ }).click();
  await page.fill('#register-search', 'Roadside Bed East');
  await page.getByRole('button', { name: /Roadside Bed East Side/ }).first().click();
  await page.getByRole('button', { name: 'Put it on the map' }).click();
  for (const [dx, dy] of [[-120, -150], [120, -150], [120, 50], [-120, 50]]) await tapMap(page, dx, dy);
  await expect(page.getByText('4 points.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-draw.png` });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/Traced on the map, \d+ m²/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.panel-sub .chip')).toHaveText('Placed');
  await expect(page.getByText(/Contains \d+ items \(0 on the map\)/)).toBeVisible();

  // Place one of its planting groups inside it; parent should stay the bed.
  await page.getByRole('button', { name: /Persicaria bistorta/ }).click();
  await page.getByRole('button', { name: 'Put it on the map' }).click();
  for (const [dx, dy] of [[-60, -100], [0, -100], [0, -40], [-60, -40]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#feature-parent')).toHaveValue('bed-roadside-east');
  await page.locator('#obs-text').fill('Flowering well, pink spikes');
  await page.selectOption('#obs-kind', 'flowering');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.log li')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/05-drift.png` });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.locator('.badge')).toHaveText(String(unplacedBefore - 2));

  // Layers and data panels.
  await page.getByRole('button', { name: 'Layers' }).click();
  await page.screenshot({ path: `${SHOTS}/06-layers.png` });
  await page.getByRole('button', { name: 'Data' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Back up everything/ }).click();
  const file = await dl;
  await file.saveAs(`${SHOTS}/backup.zip`);
  await expect(page.getByText(/Last backup: \d/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-data.png` });

  // Reload: data persists.
  await page.reload();
  await expect(page.locator('.badge')).toHaveText(String(unplacedBefore - 2));
  expect(errors).toEqual([]);
});

test('lines show on the map and can be tapped', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  // A cable run is dashed and a hedge is solid; they're drawn by separate map layers.
  for (const [type, name, dy] of [['Cable run', 'Cable to the pump', -60], ['Hedge', 'Yew hedge', 60]] as const) {
    await page.getByRole('button', { name: 'Capture' }).click();
    await page.getByRole('button', { name: type, exact: true }).click();
    await tapMap(page, -100, dy);
    await tapMap(page, 100, dy);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.fill('#capture-name', name);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.panel-head h2')).toHaveText(name);
    // Saving flies to the middle of the line (600ms). Closing the panel mid-flight stops the camera short.
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(async () => {
      await tapMap(page, 0, 0);
      await expect(page.locator('.panel-head h2')).toHaveText(name, { timeout: 1000 });
    }).toPass();
    await page.screenshot({ path: `${SHOTS}/09-line-${type === 'Hedge' ? 'hedge' : 'cable'}.png` });
    await page.getByRole('button', { name: 'Close panel' }).click();
  }
});

test('desktop dark layout', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await page.getByRole('button', { name: /Register/ }).click();
  await page.screenshot({ path: `${SHOTS}/08-desktop-dark.png` });
  await ctx.close();
});
