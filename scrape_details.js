// This script is used to scrape the full details of each ad. 
// It is used to get the full details of each ad so that we can use them to upload the ad to the website.
// It is number 2 in the adverts_scraper.cjs script.


// 📄 Full Adverts.ie Scraper with Clear Image Extraction

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

(async () => {
  const inputPath = path.join(__dirname, 'scraped_ads.json');
  const outputPath = path.join(__dirname, 'full_details.json');

  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const scrapedAds = rawData.map(ad => typeof ad === 'string' ? { url: ad } : ad);

  let savedAds = [];
  if (fs.existsSync(outputPath)) {
    try {
      savedAds = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    } catch (_) {}
  }

  const scrapedUrls = new Set(savedAds.map(a => a.url));
  const adsToScrape = scrapedAds.filter(ad => !scrapedUrls.has(ad.url));

  const browser = await puppeteer.launch({ headless: false });
  let page = await browser.newPage();
  await page.setDefaultNavigationTimeout(40000);

  let count = savedAds.length + 1;

  for (const ad of adsToScrape) {
    let retries = 0;
    let success = false;

    while (retries < 3 && !success) {
      console.log(`\n📄 Scraping ad ${count} of ${scrapedAds.length}: ${ad.url} (Attempt ${retries + 1})`);

      try {
        await page.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 🍪 Accept cookies
        try {
          await page.waitForSelector('button[mode="primary"], button:has-text("Accept All")', { timeout: 5000 });
          await page.click('button[mode="primary"], button:has-text("Accept All")');
          console.log('🍪 Accepted cookies');
        } catch {
          console.log('🍪 No cookie popup');
        }

        await page.waitForSelector('h1', { timeout: 10000 });

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

        // 🖼 Click image to open modal
        const firstImg = await page.$('#smi_gallery img');
        if (firstImg) {
          await firstImg.click();
          await page.waitForSelector('#pbxl_carousel img', { timeout: 5000 });
        }

        // 🖼 Extract all full-size modal images
        const imageUrls = new Set();
        let previousSrc = '';

        for (let i = 0; i < 20; i++) {
          try {
            await page.waitForSelector('#pbxl_carousel img', { timeout: 3000 });

            const currentSrc = await page.$eval('#pbxl_carousel img', img => img.src);
            if (currentSrc === previousSrc) {
              console.log(`🖼 Image didn't change, assuming end of gallery.`);
              break;
            }

            imageUrls.add(currentSrc);
            previousSrc = currentSrc;

            const nextBtn = await page.$('#pbxl_right');
            if (nextBtn) {
              await nextBtn.click();
              await page.waitForTimeout(600); // let next image load
            } else {
              break;
            }

          } catch (e) {
            console.log(`⚠️ Image scraping error: ${e.message}`);
            break;
          }
        }

        data.images = Array.from(imageUrls);
        data.url = ad.url;
        savedAds.push(data);
        fs.writeFileSync(outputPath, JSON.stringify(savedAds, null, 2));
        console.log(`✅ Saved: ${data.title} — Price: ${data.price} — Images: ${data.images.length}`);
        success = true;

      } catch (err) {
        console.error(`❌ Error scraping ${ad.url}: ${err.message}`);
        retries++;
        try {
          await page.close();
          page = await browser.newPage();
          await page.setDefaultNavigationTimeout(40000);
        } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!success) {
      console.warn(`⛔️ Skipped after 3 failed attempts: ${ad.url}`);
    }

    count++;
  }

  await browser.close();
  console.log(`\n✅ Done. Total saved ads: ${savedAds.length}`);
})();