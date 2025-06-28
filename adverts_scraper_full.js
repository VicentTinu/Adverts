const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

(async () => {
  const rawData = JSON.parse(fs.readFileSync('scraped_ads.json', 'utf-8'));

  // Detect format and normalize
  const ads = rawData.map(ad => typeof ad === 'string' ? { url: ad } : ad);

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  const results = [];
  const outPath = path.join(__dirname, 'scraped_full_ads.json');
  let count = 1;

  for (const ad of ads) {
    const url = ad.url;
    console.log(`🔍 Scraping ad #${count}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1', { timeout: 10000 });

      const data = await page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText || '';
        const price = document.querySelector('.listing-price')?.innerText || '';

        const descElement = document.querySelector('[data-testid="mainDescription"]') || 
                            document.querySelector('.main-description') || 
                            document.querySelector('.listing-description');

        const description = descElement?.innerText?.trim() || '';

        const imageElements = document.querySelectorAll('.gallery__thumbs img, .image-gallery img');
        const images = Array.from(imageElements).map(img => img.src || img.getAttribute('data-src'));

        return { title, price, description, images };
      });

      data.url = url;
      results.push(data);

      // 💾 Save after each successful scrape
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
      console.log(`✅ Scraped: ${data.title} (${data.images.length} images)`);

    } catch (err) {
      console.log(`❌ Failed to scrape ${url}: ${err.message}`);
    }

    count++;
  }

  console.log(`\n📦 Done. Total saved ads: ${results.length}`);
  await browser.close();
})();