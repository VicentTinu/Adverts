const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const readline = require('readline');

puppeteer.use(StealthPlugin());

function waitForEnter() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('🟢 Press Enter when logged in...\n', () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  const categories = JSON.parse(fs.readFileSync('adverts_categories.json', 'utf-8'));

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://www.adverts.ie/sell', { waitUntil: 'domcontentloaded' });
  console.log('🔐 Manual login required.');
  await waitForEnter();

  for (const categoryName of Object.keys(categories)) {
    console.log(`➡️ Trying category: ${categoryName}`);

    await page.goto('https://www.adverts.ie/sell', { waitUntil: 'domcontentloaded' });

    // Inject dummy title to force category UI to load
    try {
      await page.waitForSelector('input[name="title"]', { timeout: 10000 });
      await page.type('input[name="title"]', 'AUTOTEST_' + categoryName);
    } catch (e) {
      console.log(`⚠️ Skipping ${categoryName}: title input not found`);
      continue;
    }

    // Wait for top-level categories
    try {
      await page.waitForSelector('.category-holder a', { timeout: 15000 });
    } catch (e) {
      console.log(`❌ Failed to load top-level category list for ${categoryName}`);
      continue;
    }

    // Click the main category
    const clicked = await page.evaluate((catName) => {
      const links = Array.from(document.querySelectorAll('.category-holder a'));
      const match = links.find(el => el.textContent.trim() === catName);
      if (match) {
        match.click();
        return true;
      }
      return false;
    }, categoryName);

    if (!clicked) {
      console.log(`❌ Could not click category: ${categoryName}`);
      continue;
    }

    // Wait after clicking to load subcategories
    await new Promise(r => setTimeout(r, 2500));

    // Try clicking the "Other" subcategory by placeholder attributes
    const clickedOther = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.category-holder a'));
      const match = links.find(el =>
        el.getAttribute('data-category-name')?.toLowerCase() === 'other' ||
        el.innerText.toLowerCase().includes('other')
      );
      if (match) {
        match.click();
        return true;
      }
      return false;
    });

    if (clickedOther) {
      console.log(`✅ Selected "${categoryName}" → "Other"`);
    } else {
      console.log(`⚠️ No 'Other' subcategory found for ${categoryName}`);
    }

    // Wait before moving on
    await new Promise(r => setTimeout(r, 3000));
  }

  await browser.close();
  console.log('🏁 Done looping all categories');
})();