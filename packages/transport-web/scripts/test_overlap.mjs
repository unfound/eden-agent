import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea', { timeout: 10000 });
  
  const textarea = page.getByRole('textbox', { name: 'Message input' });
  await textarea.fill('写一篇500字以上的随笔，关于AI的发展');
  await textarea.press('Enter');
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/eden-overlap-1.png' });
  
  await page.waitForTimeout(20000);
  await page.screenshot({ path: '/tmp/eden-overlap-2.png' });
  
  await browser.close();
  console.log('Done');
})();
