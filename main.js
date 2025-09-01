// index.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

puppeteer.use(StealthPlugin());
dotenv.config();

const WITHDRAWN_URL = 'https://www.adverts.ie/myadverts/withdrawn';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function killConsent(page) {
  // Try several common consent frameworks without throwing if missing
  const clicks = [
    "button#onetrust-accept-btn-handler",
    "button[aria-label='Accept all']",
    "button:has-text('Accept All')",
    "button:has-text('Accept all')",
  ];
  for (const sel of clicks) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click().catch(()=>{}); await sleep(300); return; }
    } catch { /* ignore */ }
  }
}

async function ensureLoggedIn(page) {
  await page.goto('https://www.adverts.ie/login', { waitUntil: 'domcontentloaded' });
  await killConsent(page);

  // If already logged in, adverts may redirect to /myadverts
  const isLogin = !!(await page.$('input#email'));
  if (!isLogin) return; // already logged in

  await page.type('input#email', process.env.ADVERTS_EMAIL, { delay: 20 });
  await page.type("input[name='password']", process.env.ADVERTS_PASSWORD, { delay: 20 });

  console.log('🛑 Solve CAPTCHA + Login — 30 seconds...');
  await sleep(30000);

  // Submit login (press Enter)
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});

  // Post-login check: look for avatar or user menu
  const loggedIn = await page.$("a[href*='/myadverts'], .user-menu, img[alt*='avatar']");
  if (!loggedIn) console.warn('⚠️ Not clearly logged in—continuing anyway');
}

async function safeGoto(page, url, { attempts = 3 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await killConsent(page);
      // Simple anti-bot: let JS settle a moment
      await sleep(800);
      // sanity: ensure body exists
      await page.waitForSelector('body', { timeout: 15000 });
      return;
    } catch (e) {
      console.warn(`⚠️ goto failed (${i}/${attempts}) for ${url}: ${e.message}`);
      if (i === attempts) throw e;
      await sleep(2000 * i);
    }
  }
}

async function clickAndWaitNav(page, clickSelector) {
  await page.waitForSelector(clickSelector, { timeout: 15000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
    page.click(clickSelector)
  ]);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1400,900'
    ]
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);

  // A real UA reduces CDN challenges a bit
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  // --- Login ---
  await ensureLoggedIn(page);

  let relisted = 0;

  while (true) {
    // --- Load withdrawn page robustly ---
    try {
      await safeGoto(page, WITHDRAWN_URL, { attempts: 3 });
    } catch (err) {
      console.error('❌ Could not load withdrawn page after retries:', err.message);
      break;
    }

    // Wait for the list container (tweak selector if needed)
    // Fall back to scanning links if container not present
    await page.waitForSelector('body');

    // Collect relist links visible on this page
    const relistLinks = await page.$$eval("a[href*='/relist/']", links =>
      Array.from(new Set(links.map(l => l.href)))
    );

    if (relistLinks.length === 0) {
      console.log('🎉 No more relistable ads left.');
      break;
    }

    console.log(`🔗 Found ${relistLinks.length} relist links.`);

    for (const link of relistLinks) {
      try {
        await safeGoto(page, link, { attempts: 2 });

        // Wait for the relist form bits that actually appear
        // Prefer a specific selector if you can inspect the page (ids/classes)
        const submitSelectors = [
          "form button[type='submit']",
          "input[type='submit'][value='Free']",
          "button:has-text('Relist')",
          "button:has-text('Free')"
        ];

        let clicked = false;
        for (const sel of submitSelectors) {
          const has = await page.$(sel);
          if (has) {
            await clickAndWaitNav(page, sel);
            clicked = true;
            break;
          }
        }

        // Some flows show a confirm step; try to catch it
        if (!clicked) {
          const confirmSel = "button:has-text('Confirm'), input[type='submit'][value*='Confirm']";
          const confirm = await page.$(confirmSel);
          if (confirm) {
            await clickAndWaitNav(page, confirmSel);
            clicked = true;
          }
        }

        if (!clicked) {
          // If nothing clicked, try a form submit via JS as a fallback
          await page.evaluate(() => {
            const f = document.querySelector('form');
            if (f) f.submit();
          });
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(()=>{});
        }

        console.log(`✅ Relisted #${++relisted}: ${link}`);

        // small jitter helps evade rate limits
        await sleep(500 + Math.floor(Math.random() * 750));
      } catch (err) {
        console.error(`❌ Failed to relist: ${link} — ${err.message}`);
        // If we got bounced to login, try to re-login once and retry this link
        try {
          const onLogin = await page.$('input#email');
          if (onLogin) {
            console.warn('↪️ Detected logout—relogging...');
            await ensureLoggedIn(page);
            await sleep(1000);
            // retry once
            await safeGoto(page, link, { attempts: 1 });
            // attempt same click logic again quickly
            const submit = await page.$("form button[type='submit'], input[type='submit']");
            if (submit) {
              await clickAndWaitNav(page, "form button[type='submit'], input[type='submit']");
              console.log(`✅ Relisted (after re-login): ${link}`);
              relisted++;
            }
          }
        } catch (e) {
          console.error(`↪️ Retry after re-login failed for ${link}: ${e.message}`);
        }
      }
    }

    // Optional: handle pagination on withdrawn page if present
    // const next = await page.$("a[rel='next'], .pagination a.next");
    // if (next) {
    //   await clickAndWaitNav(page, "a[rel='next'], .pagination a.next");
    // } else {
    //   break;
    // }
  }

  console.log(`🎯 Done. Total relisted: ${relisted}`);
  // await browser.close();
})();