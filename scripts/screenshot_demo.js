import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const url = process.env.DEMO_URL || 'http://localhost:3002/demo/produkt-mockup/';
  const out = process.env.OUT || 'local_demo_screenshot.png';
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setViewport({ width: 1200, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  // wait a bit for canvas lazy-load to settle
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: true });
  console.log('Saved screenshot to', out);
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
