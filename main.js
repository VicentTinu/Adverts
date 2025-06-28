const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
require("dotenv").config();

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  // STEP 1: Login
  await page.goto("https://www.adverts.ie/login", { waitUntil: "networkidle2" });
  await page.waitForSelector("input#email");
  await page.type("input#email", process.env.ADVERTS_EMAIL);
  await page.waitForSelector("input[name='password']");
  await page.type("input[name='password']", process.env.ADVERTS_PASSWORD);

  console.log("🛑 Solve CAPTCHA + Login — 30 seconds...");
  await new Promise(resolve => setTimeout(resolve, 30000));
  await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
  console.log("✅ Logged in.");

  let relisted = 0;

  while (true) {
    // Retry wrapper for slow page load
    let tries = 0;
    while (tries < 3) {
      try {
        await page.goto("https://www.adverts.ie/myadverts/withdrawn", {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });
        break;
      } catch (err) {
        tries++;
        console.warn(`⚠️ Failed to load withdrawn page (attempt ${tries})`);
        if (tries === 3) throw err;
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    const relistLinks = await page.$$eval("a[href*='/relist/']", links => links.map(link => link.href));

    if (relistLinks.length === 0) {
      console.log("🎉 No more relistable ads left.");
      break;
    }

    console.log(`🔗 Found ${relistLinks.length} relist links.`);

    for (const link of relistLinks) {
      try {
        await page.goto(link, { waitUntil: "networkidle2" });
        await page.waitForSelector("button[type='submit'], input[value='Free']", { timeout: 5000 });
        await page.click("button[type='submit'], input[value='Free']");
        console.log(`✅ Relisted #${++relisted}: ${link}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`❌ Failed to relist: ${link}`, err);
      }
    }
  }

  console.log(`🎯 Done. Total relisted: ${relisted}`);
})();