#!/usr/bin/env node
/**
 * screenshot.mjs — Puppeteer screenshot helper for Claude Code workflow
 *
 * Usage:
 *   node screenshot.mjs <url>               → saves screenshot-N.png
 *   node screenshot.mjs <url> <label>       → saves screenshot-N-label.png
 *
 * Screenshots are saved to ./temporary screenshots/ (auto-incremented, never overwritten).
 * Run from your project root.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url   = process.argv[2];
const label = process.argv[3];

if (!url) {
  console.error('Usage: node screenshot.mjs <url> [label]');
  process.exit(1);
}

const SCREENSHOT_DIR = './temporary screenshots';

// Create output directory if it doesn't exist
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Find next available filename (never overwrite)
function getNextPath() {
  let n = 1;
  while (true) {
    const name = label
      ? `screenshot-${n}-${label}.png`
      : `screenshot-${n}.png`;
    const fullPath = path.join(SCREENSHOT_DIR, name);
    if (!fs.existsSync(fullPath)) return fullPath;
    n++;
  }
}

const outputPath = getNextPath();

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

try {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: outputPath });
  console.log(`✓ Screenshot saved: ${outputPath}`);
} catch (err) {
  console.error('Error taking screenshot:', err.message);
  process.exit(1);
} finally {
  await browser.close();
}
