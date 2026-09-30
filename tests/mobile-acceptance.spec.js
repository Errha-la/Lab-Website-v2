import { expect, test } from '@playwright/test';

const pages = [
  { id: 'home', marker: '#scrollwrap' },
  { id: 'about', marker: '.about-photo' },
  { id: 'professor', marker: '.cv-page' },
  { id: 'team', marker: '#teamWrap' },
  { id: 'publications', marker: '.radio-inputs' },
  { id: 'contact', marker: '#contactDetails' },
];
const viewports = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function selectPage(page, index) {
  await page.locator('.mobile-menu-button').click();
  await expect(page.locator('#mobileNavPanel')).toBeVisible();
  await page.locator('#mobileNavPanel .navlink').nth(index).click();
  await expect(page.locator(pages[index].marker)).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const controls = [...document.querySelectorAll('button,a,select,input')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({ label: el.getAttribute('aria-label') || el.textContent.trim(), right: el.getBoundingClientRect().right }))
      .filter((el) => el.right > width + 1);
    return { width, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, controls };
  });
  expect(layout, JSON.stringify(layout)).toMatchObject({ width: expect.any(Number), document: expect.any(Number), body: expect.any(Number) });
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  expect(layout.body, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  expect(layout.controls, JSON.stringify(layout)).toEqual([]);
}

async function checkTeam(page) {
  const filter = page.locator('#teamWrap select').first();
  await expect(filter).toBeVisible();
  const allMembers = await page.locator('#teamWrap img[data-member-photo]').count();
  await filter.selectOption('113');
  const images = page.locator('#teamWrap img[data-member-photo]');
  await expect(images.first()).toBeVisible();
  expect(await images.count()).toBeLessThan(allMembers);
  const photoState = await images.evaluateAll((nodes) => nodes.map((img) => {
    const frame = img.closest('.member-photo-frame');
    const box = frame.getBoundingClientRect();
    return { loaded: img.complete && img.naturalWidth > 0, fit: getComputedStyle(img).objectFit, width: box.width, height: box.height };
  }));
  expect(photoState.length).toBeGreaterThan(0);
  expect(photoState.every((photo) => photo.loaded && photo.fit === 'cover')).toBe(true);
  expect(photoState.every((photo) => photo.width >= 96 && photo.height >= 96 && photo.width <= 112 && photo.height <= 112)).toBe(true);
}

async function checkPublications(page) {
  const filters = page.locator('select.input');
  await filters.nth(0).selectOption('journal');
  await expect(page.locator('#g-pubs article')).not.toHaveCount(0);
  await filters.nth(1).selectOption('25');
  const sort = page.locator('.mobile-page-content .btn-secondary').first();
  const newest = await sort.textContent();
  await sort.click();
  await expect(sort).not.toHaveText(newest);
  await page.locator('#pubTagFilters button').first().click();
  await expect(page.locator('#g-pubs article')).not.toHaveCount(0);
  await page.locator('.mobile-page-content .btn-ghost').click();
  await page.locator('.radio-inputs .radio').nth(1).click();
  await expect(page.locator('#graphsvg')).toBeVisible();
  const graph = page.locator('#graphsvg g[data-graph-transform]');
  const before = await graph.getAttribute('transform');
  await page.locator('#g-graph button').nth(1).click();
  await expect.poll(() => graph.getAttribute('transform')).not.toBe(before);
  await expect(page.locator('#graphsvg circle')).not.toHaveCount(0);
}

async function checkContact(page) {
  const email = page.locator('#contactDetails a[href^="mailto:"]');
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('href', /^mailto:/);
  const mapLink = page.locator('#g-contact figure a[href^="https://www.google.com/maps"]');
  await expect(mapLink).toBeVisible();
  await expect(mapLink).toHaveAttribute('href', /^https?:/);
  await expect(page.locator('#g-contact iframe')).toBeVisible();
  await page.locator('#g-contact button').nth(1).click();
  await expect(page.locator('#g-contact li').first()).toBeVisible();
}

async function checkAbout(page) {
  const photo = page.locator('.about-photo img');
  const current = await photo.evaluateAll((images) => images.findIndex((img) => Number(getComputedStyle(img).opacity) > 0.9));
  await page.locator('.about-photo button[aria-label*="Next"]').click();
  await expect.poll(() => photo.evaluateAll((images) => images.findIndex((img) => Number(getComputedStyle(img).opacity) > 0.9))).not.toBe(current);
  const card = page.locator('#g-tech [data-card]').first();
  await card.tap();
  await expect(card).toHaveAttribute('data-flipped', '1');
}

async function checkProfessor(page) {
  await expect(page.locator('.cv-mail[href^="mailto:"]')).toBeVisible();
  await page.locator('.cv-more').click();
  await expect(page.locator('.radio-inputs')).toBeVisible();
}

async function checkStory(page, testInfo) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('3D line failed')) errors.push(message.text());
  });
  const checkpoints = await page.evaluate(async () => {
    const timeline = await import('./assets/js/story-timeline.js');
    const wrap = document.querySelector('#scrollwrap');
    const total = Math.max(1, wrap.offsetHeight - innerHeight);
    return Array.from({ length: 6 }, (_, act) => ({ act, progress: timeline.actStart(act), total }));
  });

  for (const { act, progress, total } of checkpoints) {
    await page.evaluate(({ progress, total }) => {
      const wrap = document.querySelector('#scrollwrap');
      scrollTo(0, wrap.getBoundingClientRect().top + scrollY + progress * total);
    }, { progress, total });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#lineFallback')).display === 'none', null, { timeout: 30_000 });
    await expect(page.locator(`#actNav [data-actjump="${act}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(`[data-panel="${act}"]`)).toHaveCSS('opacity', '1');
    const evidence = await page.evaluate(() => {
      const canvas = document.querySelector('#lineCanvas');
      const nav = document.querySelector('#actNav').getBoundingClientRect();
      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        navFits: nav.left >= -1 && nav.right <= innerWidth + 1,
        fallbackHidden: getComputedStyle(document.querySelector('#lineFallback')).display === 'none',
      };
    });
    expect(errors).toEqual([]);
    expect(evidence.canvasWidth).toBeGreaterThan(0);
    expect(evidence.canvasHeight).toBeGreaterThan(0);
    expect(evidence.navFits).toBe(true);
    expect(evidence.fallbackHidden).toBe(true);
    const screenshot = testInfo.outputPath(`story-${act + 1}-${testInfo.project.name}-${testInfo.title.replaceAll(/[^a-z0-9-]/gi, '-')}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`story checkpoint ${act + 1}`, { path: screenshot, contentType: 'image/png' });
  }
}

for (const viewport of viewports) {
  for (const language of ['zh', 'en']) {
    for (const [pageIndex, target] of pages.entries()) {
      test(`${viewport.width}x${viewport.height} ${language} ${target.id}`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        const page = await context.newPage();
        try {
          await page.goto('/', { waitUntil: 'load' });
          await page.waitForFunction(() => window.React && window.ReactDOM && window.STORY_DATA);
          if (language === 'en') {
            await page.locator('.mobile-menu-button').click();
            await page.locator('#mobileNavPanel .mobile-lang').click();
          }
          await expect(page.locator('html')).toHaveAttribute('data-lang', language);
          await page.locator('.mobile-menu-button').click();
          await expect(page.locator('#mobileNavPanel')).toBeVisible();
          await page.locator('.mobile-menu-button').click();
          await expect(page.locator('#mobileNavPanel')).toBeHidden();
          await selectPage(page, pageIndex);
          await expectNoHorizontalOverflow(page);

          if (target.id === 'team') await checkTeam(page);
          if (target.id === 'publications') await checkPublications(page);
          if (target.id === 'contact') await checkContact(page);
          if (target.id === 'about') await checkAbout(page);
          if (target.id === 'professor') await checkProfessor(page);
          if (target.id === 'home') await checkStory(page, testInfo);

          await page.locator('.mobile-menu-button').click();
          await expect(page.locator('.mobile-menu-button')).toHaveAttribute('aria-expanded', 'true');
          const nextLanguage = language === 'zh' ? 'en' : 'zh';
          await page.locator('#mobileNavPanel .mobile-lang').click();
          await expect(page.locator('html')).toHaveAttribute('data-lang', nextLanguage);
          await expect(page.locator('#mobileNavPanel')).toBeHidden();

          for (let i = 0; i < pages.length; i++) {
            await selectPage(page, i);
            await expectNoHorizontalOverflow(page);
          }
        } catch (error) {
          const screenshot = testInfo.outputPath('failure.png');
          await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {});
          await context.tracing.stop({ path: testInfo.outputPath('trace.zip') }).catch(() => {});
          await testInfo.attach('failure screenshot', { path: screenshot, contentType: 'image/png' }).catch(() => {});
          await testInfo.attach('failure trace', { path: testInfo.outputPath('trace.zip'), contentType: 'application/zip' }).catch(() => {});
          throw error;
        } finally {
          await context.close();
        }
      });
    }
  }
}
