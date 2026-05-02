const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const inputs = await page.evaluate(() => {
    const all = document.querySelectorAll('textarea, input, [contenteditable]');
    return Array.from(all).map(el => ({
      tag: el.tagName,
      placeholder: el.getAttribute('placeholder') || '',
      visible: !!el.offsetParent,
    }));
  });
  console.log('Inputs:', JSON.stringify(inputs));

  const textarea = page.locator('textarea');
  const count = await textarea.count();
  if (count > 0) {
    await textarea.first().click();
    await page.waitForTimeout(300);
    await textarea.first().fill('你好');
    const val = await textarea.first().inputValue();
    console.log('Typed:', JSON.stringify(val));
    console.log('INPUT_OK');
  } else {
    console.log('NO_TEXTAREA');
  }
  await browser.close();
})().catch(e => console.error(e.message));
