// This script is used to scrape the URLs of all ads on the adverts.ie website.
// It is used to get the URLs of all ads so that we can scrape the full details of each ad.
// It is number 1 in the adverts_scraper.cjs script.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🔐 Opening login page — solve CAPTCHA + login manually...');
  await page.goto('https://www.adverts.ie/login', { waitUntil: 'domcontentloaded' });
  await new Promise(resolve => setTimeout(resolve, 20000));

  const allLinks = new Set();
  let pageNum = 1;

  while (true) {
    const targetUrl = `https://www.adverts.ie/member/1621556/ads?page=${pageNum}`;
    console.log(`➡️ Visiting: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForSelector('.info-box a', { timeout: 15000 });
    } catch (err) {
      console.log('⚠️ No .info-box a elements found on this page. Stopping.');
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('.info-box a'));
      return anchors.map(el => el.href);
    });

    const filtered = links.filter(link =>
      link.startsWith('https://www.adverts.ie/') &&
      !link.includes('/member/') &&
      !link.includes('/for-sale/') &&
      !link.includes('#')
    );

    const beforeCount = allLinks.size;
    filtered.forEach(link => allLinks.add(link));

    // ✅ Save progress after each page
    fs.writeFileSync('scraped_ads.json', JSON.stringify([...allLinks], null, 2));

    const newCount = allLinks.size;
    const addedThisPage = newCount - beforeCount;
    console.log(`📦 Page ${pageNum}: ${addedThisPage} new links added.`);

    if (addedThisPage === 0) {
      console.log('🛑 No new ads found. Finished scraping.');
      break;
    }

    pageNum++;
  }

  console.log(`✅ Saved ${allLinks.size} total unique ads to scraped_ads.json`);
  await browser.close();
})();
