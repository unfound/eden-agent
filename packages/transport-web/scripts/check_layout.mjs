import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 10000 });
  
  // Send a message
  const input = page.getByRole('textbox', { name: 'Message input' });
  await input.fill('帮我写一篇800字的散文，关于清晨的阳光');
  await input.press('Enter');
  
  // Wait for response to complete
  await page.waitForTimeout(25000);
  
  // Check positions of key elements
  const viewportBox = await page.evaluate(() => {
    const vp = document.querySelector('[data-slot="aui_thread-viewport"]');
    if (!vp) return null;
    const vpRect = vp.getBoundingClientRect();
    
    // Find the footer/composer
    const footer = document.querySelector('.aui-thread-viewport-footer');
    const composer = document.querySelector('.aui-composer-root');
    
    // Find messages
    const msgGroups = document.querySelectorAll('[data-slot="aui_message-group"]');
    
    const results = {
      viewport: { top: vpRect.top, bottom: vpRect.bottom, height: vpRect.height },
      footer: footer ? (() => {
        const r = footer.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, zIndex: getComputedStyle(footer).zIndex, position: getComputedStyle(footer).position };
      })() : null,
      composer: composer ? (() => {
        const r = composer.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      })() : null,
      messages: [],
    };
    
    msgGroups.forEach((mg, i) => {
      const r = mg.getBoundingClientRect();
      results.messages.push({ index: i, top: r.top, bottom: r.bottom });
    });
    
    // Check for overlapping elements at the bottom
    if (results.footer && results.composer) {
      results.overlap = results.footer.top < results.viewport.bottom - 50;
      results.composerInView = results.composer.bottom <= results.viewport.bottom;
    }
    
    return results;
  });
  
  console.log(JSON.stringify(viewportBox, null, 2));
  
  await page.screenshot({ path: '/tmp/eden-fixed-ui.png' });
  await browser.close();
  console.log('Screenshot saved');
})();
