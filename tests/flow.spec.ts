import { readFileSync } from 'node:fs';
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
  await page.getByRole('button', { name: 'More' }).click();
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
  await page.getByRole('button', { name: 'More' }).click();
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

test('items report lists everything and filters it', async ({ page }) => {
  const count = page.locator('#report-count');
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  // Log something so one item has a latest entry.
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByRole('tab', { name: /Rough/ }).click();
  await page.getByRole('button', { name: /Island silver birch 1/ }).click();
  await page.selectOption('#obs-kind', 'condition');
  await page.locator('#obs-text').fill('Light prune due');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();

  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(count).toHaveText('108 of 108 items');
  // On a phone the filters fold away behind a button that counts them.
  await expect(page.locator('#report-status')).toBeHidden();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.selectOption('#report-status', 'rough');
  await expect(count).toHaveText('15 of 108 items');
  // Dingley Dell's rough items: two air vents and five birches.
  await page.selectOption('#report-area', 'bed-dingley-dell');
  await expect(count).toHaveText('7 of 108 items');
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('2');
  await page.screenshot({ path: `${SHOTS}/13-report.png` });
  await page.getByRole('button', { name: 'Remove filter: Rough' }).click();
  await expect(count).toHaveText('25 of 108 items');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(count).toHaveText('108 of 108 items');
  await page.selectOption('#report-type', 'tree');
  await page.fill('#report-search', 'birch');
  await expect(count).toHaveText('8 of 108 items');
  await page.selectOption('#report-sort', 'recent');
  await expect(page.locator('.report-table tbody tr').first()).toContainText('Condition: Light prune due');

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download spreadsheet' }).click();
  const lines = readFileSync((await (await dl).path())!, 'utf8').split('\r\n');
  expect(lines).toHaveLength(9);
  expect(lines[0]).toMatch(/^﻿"Name","Type"/);
  expect(lines[1]).toContain('"Island silver birch 1","Tree","Plants","Dingley Dell (the island)","Betula pendula","Silver birch"');
  expect(lines[1]).toContain('"Condition","Light prune due","1","0"');

  // Tapping an item opens it.
  await page.getByRole('button', { name: 'Island silver birch 1', exact: true }).click();
  await expect(page.locator('.panel-head h2')).toHaveText('Island silver birch 1');
});

test('add an entry to the register without placing it', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  const toPlace = Number(await page.locator('.badge').textContent());
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.selectOption('#entry-type', 'drift');
  await page.locator('#taxon-search').fill('Astrantia');
  await page.getByRole('button', { name: /Astrantia 'Roma'/ }).first().click();
  await page.fill('#entry-qty', '5');
  await page.selectOption('#entry-parent', 'bed-riverside');
  await page.fill('#entry-notes', 'Bought at the plant sale, in pots by the shed');
  await page.getByRole('button', { name: 'Add to register' }).click();

  // Named after the species, off the map, and counted in To place.
  await expect(page.locator('.panel-head h2')).toHaveText("Astrantia 'Roma'");
  await expect(page.locator('.panel-sub .chip')).toHaveText('Not on map');
  await expect(page.locator('#feature-parent')).toHaveValue('bed-riverside');
  await expect(page.locator('.badge')).toHaveText(String(toPlace + 1));
  await page.getByRole('button', { name: 'Put it on the map' }).click();
  await expect(page.getByRole('toolbar', { name: 'Drawing' })).toBeVisible();
});

test('calendar of recurring jobs', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T10:00:00'));
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(page.getByText('Nothing due in October.')).toBeVisible();
  const december = page.getByRole('region', { name: 'December 2026' });
  await expect(december).toContainText('Check tree ties and stakes');
  await expect(december).toContainText('Winter tree survey with the tree surgeons');
  await expect(page.getByRole('region', { name: 'February 2027' })).toContainText('Prune Cotoneaster hedge back from railings');

  // Marking a job done logs it on the tree it's for.
  const pine = page.locator('.job', { hasText: 'Inspect the Scots pine' });
  await pine.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByText('Marked done and logged on 1 item.')).toBeVisible();
  await expect(pine.locator('.chip')).toHaveText('Done');

  // A new job for this month, moved to next month, then deleted.
  await page.getByRole('button', { name: 'Add a job' }).click();
  await page.fill('#job-what', 'Clean the pond pump filter');
  await page.getByRole('button', { name: 'Oct', exact: true }).click();
  await page.selectOption('#job-feature', 'water-moat');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: /Due now/ })).toContainText('Clean the pond pump filter');
  await page.getByRole('button', { name: /Clean the pond pump filter/ }).click();
  await page.getByRole('button', { name: 'Oct', exact: true }).click();
  await page.getByRole('button', { name: 'Nov', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Next month' })).toContainText('Clean the pond pump filter');
  await expect(page.locator('.job', { hasText: 'Clean the pond pump filter' })).toContainText('Nov · The moat');
  await page.screenshot({ path: `${SHOTS}/14-calendar.png` });
  await page.getByRole('button', { name: /Clean the pond pump filter/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete this job' }).click();
  await expect(page.getByText('Clean the pond pump filter')).toHaveCount(0);

  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByRole('tab', { name: 'Everything' }).click();
  await page.fill('#register-search', 'Scots pine');
  await page.getByRole('button', { name: /Scots pine/ }).first().click();
  await expect(page.locator('.log li')).toContainText('Inspect the Scots pine');
});

test('upgrading from the first version keeps the data and adds the calendar', async ({ page }) => {
  // A page on the app's origin that doesn't run the app, to build a version 1 database by hand.
  await page.goto('./manifest.webmanifest');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('providence-garden', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('features', { keyPath: 'id' });
          d.createObjectStore('observations', { keyPath: 'id' }).createIndex('byFeature', 'featureId');
          for (const s of ['photos', 'taxa', 'parties']) d.createObjectStore(s, { keyPath: 'id' });
          d.createObjectStore('meta', { keyPath: 'key' });
        };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const d = r.result;
          const tx = d.transaction(['features', 'meta'], 'readwrite');
          const ring = [[-0.0704, 51.5014], [-0.0694, 51.5013], [-0.0694, 51.5016], [-0.0704, 51.5014]];
          tx.objectStore('features').put({ id: 'water-moat', type: 'water-body', name: 'The moat', geometry: { type: 'Polygon', coordinates: [ring] }, positionStatus: 'refined', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' });
          tx.objectStore('meta').put({ key: 'seededAt', value: '2026-10-21T00:00:00Z' });
          tx.oncomplete = () => {
            d.close();
            resolve();
          };
        };
      }),
  );
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.locator('#report-count')).toHaveText('1 of 1 items');
  await expect(page.locator('.report-table tbody tr')).toContainText('Placed');
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(page.locator('.job')).toHaveCount(12);
});

test('panels drag between peek, half and full on a phone', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.loading')).toBeHidden();
  await page.getByRole('button', { name: /Register/ }).click();
  const sheet = page.locator('.sheet');
  const stage = (await page.locator('.stage').boundingBox())!.height;
  const height = async () => (await sheet.boundingBox())!.height;
  const drag = async (dy: number) => {
    const g = (await page.locator('.sheet-grip').boundingBox())!;
    const [x, y] = [g.x + g.width / 2, g.y + g.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 8 });
    await page.mouse.up();
  };
  await expect.poll(height).toBeCloseTo(stage * 0.6, -1);
  await drag(-300);
  await expect.poll(height).toBeCloseTo(stage - 12, -1);
  await drag(600);
  await expect.poll(height).toBeCloseTo(Math.min(150, stage * 0.3), -1);
  // Tapping the grip brings it back up.
  await page.locator('.sheet-grip').click();
  await expect.poll(height).toBeCloseTo(stage * 0.6, -1);
  // Pulled right down, it closes.
  await drag(500);
  await expect(sheet).toBeHidden();
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
