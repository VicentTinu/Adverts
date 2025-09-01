// This script is used to scrape the full details of each ad. 
// It is used to get the full details of each ad so that we can use them to upload the ad to the website.
// It is number 2 in the adverts_scraper.cjs script.


const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

(async () => {
  const rawData = JSON.parse(fs.readFileSync('scraped_ads.json', 'utf-8'));
  const ads = rawData.map(ad => typeof ad === 'string' ? { url: ad } : ad);

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  const outPath = path.join(__dirname, 'full_details.json');
  fs.writeFileSync(outPath, JSON.stringify([], null, 2)); // Clear file first

  let count = 1;

  for (const ad of ads) {
    const url = ad.url;
    console.log(`📄 Scraping ad ${count} of ${ads.length}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1', { timeout: 10000 });

      // ⬇️ Scrape title, price, description
      const data = await page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText.trim() || '';
        const price = document.querySelector('span.ad_view_info_cell.price')?.innerText.trim() || '';

        const descEl =
          document.querySelector('[data-testid="mainDescription"]') ||
          document.querySelector('.main-description') ||
          document.querySelector('.listing-description');
        const description = descEl?.innerText?.trim() || '';

        return { title, price, description };
      });

      let images = [];

      // 🖼 Open modal and scrape ALL full-size images from carousel
      try {
        const firstThumb = await page.$('#smi_gallery img');
        if (firstThumb) {
          await firstThumb.click();
          await page.waitForSelector('#pbxl_carousel ul li img', { timeout: 5000 });

          images = await page.$$eval('#pbxl_carousel ul li img', imgs =>
            imgs.map(img => img.getAttribute('src')).filter(Boolean)
          );
        }
      } catch (err) {
        console.log(`⚠️ Modal image scraping error: ${err.message}`);
      }

      // 📦 Finalize and save
      data.images = images;
      data.url = url;

      const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      existing.push(data);
      fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));

      console.log(`✅ Saved: ${data.title} — Price: ${data.price} — Images: ${data.images.length}`);
    } catch (err) {
      console.error(`❌ Error scraping ${url}: ${err.message}`);
    }

    count++;
  }

  await browser.close();
})();