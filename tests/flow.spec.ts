import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS ?? 'test-results';
test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, permissions: ['geolocation'], geolocation: { latitude: 51.50165, longitude: -0.07067, accuracy: 9 } });

async function tapMap(page: Page, dx: number, dy: number) {
  const box = (await page.getByTestId('map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Starting positions cover the garden, so tests that tap shapes they draw move off it first. */
async function panAway(page: Page) {
  const box = (await page.getByTestId('map').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(x - 150, y);
    await page.mouse.down();
    await page.mouse.move(x + 150, y, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(1000);
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
  await panAway(page);
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

const areaIn = async (page: Page, selector: string) => Number((await page.locator(selector).textContent())!.match(/(\d+) m²/)![1]);

test('moat with islands cut out of it', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await panAway(page);
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.getByRole('button', { name: 'Moat or pond' }).click();
  for (const [dx, dy] of [[-60, -60], [60, -60], [60, 60], [-60, 60]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  const solid = await areaIn(page, '.pos-box span');

  // Redraw keeps the outline, so carry on and trace the island in the middle as a hole.
  await page.getByRole('button', { name: 'Redraw' }).click();
  await page.getByRole('button', { name: 'Add a hole' }).click();
  await expect(page.getByText(/Tap round the hole/)).toBeVisible();
  for (const [dx, dy] of [[-30, -30], [30, -30], [30, 30], [-30, 30]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  const ring = await areaIn(page, '.pos-box span');
  expect(ring / solid).toBeCloseTo(0.75, 1);
  await page.fill('#capture-name', 'The moat');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.panel-head h2')).toHaveText('The moat');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: `${SHOTS}/10-moat.png` });

  // Saving zooms in on the moat: water is 80-160px from the centre, the island within 80px.
  await expect(async () => {
    await tapMap(page, 0, 120);
    await expect(page.locator('.panel-head h2')).toHaveText('The moat', { timeout: 1000 });
  }).toPass();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await tapMap(page, 0, 0);
  await page.waitForTimeout(500);
  await expect(page.locator('.panel-head h2')).toBeHidden();

  // Refining moves island corners too, and keeps the hole.
  await tapMap(page, 0, 120);
  await page.getByRole('button', { name: 'Refine position' }).click();
  await expect(page.locator('.handle')).toHaveCount(8);
  await page.waitForTimeout(1000);
  const hb = (await page.locator('.handle').nth(4).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 10, hb.y + hb.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save position' }).click();
  const refined = await areaIn(page, '.panel-sub .num');
  expect(refined / ring).toBeCloseTo(1, 1);

  // A second island from the panel. At zoom 20 the water is 160-320px from the centre; the
  // drawing toolbar covers the bottom of the map, so trace it above the first island.
  await page.getByRole('button', { name: 'Add a hole' }).click();
  await expect(page.getByText('Hole in The moat')).toBeVisible();
  await page.waitForTimeout(1000);
  for (const [dx, dy] of [[-20, -290], [20, -290], [-150, -340]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('A hole has to be inside the outer edge.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  for (const [dx, dy] of [[20, -200], [-20, -200]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  const twoIslands = await areaIn(page, '.pos-box span');
  expect(twoIslands).toBeLessThan(refined);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.panel-sub .num')).toHaveText(`${twoIslands} m²`);
});

test('an area in separate parts, like Riverside Gardens', async ({ page }) => {
  const title = page.locator('.panel-head h2');
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await panAway(page);
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.getByRole('button', { name: 'Bed', exact: true }).click();
  for (const [dx, dy] of [[-90, -30], [-30, -30], [-30, 30], [-90, 30]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Add a part' }).click();
  await expect(page.getByText('Another part of the new bed')).toBeVisible();
  for (const [dx, dy] of [[30, -30], [90, -30], [90, 30], [30, 30]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.pos-box span')).toHaveText(/m² in 2 parts/);
  await page.fill('#capture-name', 'Split bed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(title).toHaveText('Split bed');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: `${SHOTS}/11-parts.png` });

  // Saving zooms in on the middle: the parts are 80-240px either side of the centre, with a gap between.
  for (const dx of [-160, 160]) {
    await expect(async () => {
      await tapMap(page, dx, 0);
      await expect(title).toHaveText('Split bed', { timeout: 1000 });
    }).toPass();
    await page.getByRole('button', { name: 'Close panel' }).click();
  }
  await tapMap(page, 0, 0);
  await page.waitForTimeout(500);
  await expect(title).toBeHidden();

  // A third part from the panel; Refine then has handles on every part's corners.
  await tapMap(page, 160, 0);
  await page.getByRole('button', { name: 'Add a part' }).click();
  await expect(page.getByText('Another part of Split bed')).toBeVisible();
  await page.waitForTimeout(1000);
  for (const [dx, dy] of [[-30, -150], [30, -150], [30, -100]]) await tapMap(page, dx, dy);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.pos-box span')).toHaveText(/in 3 parts/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Refine position' }).click();
  await expect(page.locator('.handle')).toHaveCount(11);
});

test('register starts with rough positions to check on site', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/12-start.png` });
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByRole('tab', { name: 'Rough (15)' }).click();
  await page.getByRole('button', { name: /Riverside Gardens/ }).click();
  await expect(page.locator('.panel-sub .chip')).toHaveText('Rough');
  await expect(page.locator('.panel-sub .num')).toHaveText(/\d+ m²/);
  // Entries nobody could place from the imagery stay in the register to place.
  await page.getByRole('button', { name: /Register/ }).click();
  await page.fill('#register-search', 'Roadside Bed East');
  await page.getByRole('button', { name: /Roadside Bed East Side/ }).first().click();
  await expect(page.getByRole('button', { name: 'Put it on the map' })).toBeVisible();
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
