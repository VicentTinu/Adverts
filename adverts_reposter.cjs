require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const { ChatGPTAPI } = require('chatgpt');

puppeteer.use(StealthPlugin());

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const waitForEnter = () => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('🔐 Press Enter once logged in...\n', () => {
    rl.close();
    resolve();
  });
});

const openai = new ChatGPTAPI({ apiKey: process.env.OPENAI_API_KEY });

function clearTmpUploads() {
  const dir = path.resolve(__dirname, 'tmp_uploads');
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => fs.unlinkSync(path.join(dir, file)));
  }
}

async function getCategorySuggestion(adTitle, adDescription, categoryList) {
  const prompt = `Given the following ad title and description, choose the most suitable category from this list: ${categoryList.join(', ')}.\n\nTitle: "${adTitle}"\nDescription: "${adDescription}"\n\nReturn only the exact matching category name.`;
  try {
    const res = await openai.sendMessage(prompt);
    return res.text.trim();
  } catch (err) {
    console.error('❌ GPT error:', err.message);
    return null;
  }
}

(async () => {
  const ads = JSON.parse(fs.readFileSync('full_details.json', 'utf-8'));
  const categories = JSON.parse(fs.readFileSync('adverts_categories.json', 'utf-8'));
  const categoryList = Object.keys(categories);

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  page.on('dialog', async dialog => {
    console.log('⚠️ Dialog shown:', dialog.message());
    await dialog.accept();
  });

  await page.goto('https://www.adverts.ie/sell', { waitUntil: 'domcontentloaded' });
  await waitForEnter();

  for (const ad of ads) {
    try {
      clearTmpUploads();
      console.log(`➡️ Preparing to post: ${ad.title}`);

      await page.goto('https://www.adverts.ie/sell', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[name="title"]');
      await page.type('input[name="title"]', 'AUTOTEST_' + ad.title);

      const suggestedCategory = await getCategorySuggestion(ad.title, ad.description, categoryList);
      console.log(`📂 GPT Suggested Category: ${suggestedCategory}`);

      if (suggestedCategory) {
        await page.evaluate((catName) => {
          const links = Array.from(document.querySelectorAll('.category-holder a'));
          const match = links.find(el => el.textContent.trim() === catName);
          if (match) match.click();
        }, suggestedCategory);
        await wait(1500);
      }

      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('.category-holder a'));
        const match = links.find(el => el.textContent.toLowerCase().includes('other'));
        if (match) match.click();
      });

      await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[name="title"]');
      await page.evaluate(() => document.querySelector('input[name="title"]').value = '');
      await page.type('input[name="title"]', ad.title);
      await page.type('textarea[name="description"]', ad.description);

      const brandCheckbox = await page.$('#brand_new');
      if (brandCheckbox) await brandCheckbox.click();

      const cleanPrice = ad.price.toString().replace(/[^\d.]/g, '');
      await page.type('input[name="price"]', cleanPrice);

      const shippingOptions = ['Delivery', 'Post/Courier'];
      for (const label of shippingOptions) {
        await page.evaluate((text) => {
          const labelEl = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes(text));
          if (labelEl) labelEl.click();
        }, label);
      }

      const payments = ['Paypal', 'Bank Transfer', 'To be arranged'];
      for (const label of payments) {
        await page.evaluate((text) => {
          const labelEl = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes(text));
          if (labelEl) labelEl.click();
        }, label);
      }

      await page.waitForSelector('select[name="county_id"]', { timeout: 20000 });
      await page.select('select[name="county_id"]', '1');
      await page.select('select[name="area_id"]', '47');
      await page.click('input#donedeal_paid_share_no');

      // 🧠 Switch to Basic Uploader
      await page.evaluate(() => {
        const toggle = document.querySelector('.js-switch-to-basic-action');
        if (toggle) toggle.click();
      });
      await wait(1000);

      // ✅ Upload files using basic uploader
      const tmpDir = path.resolve(__dirname, 'tmp_uploads');
      const imageFiles = fs.readdirSync(tmpDir).filter(f => /\.(jpe?g|png)$/i.test(f));
      const uploadFields = ['file1', 'file2', 'file3', 'file4', 'file5'];

      for (let i = 0; i < Math.min(imageFiles.length, uploadFields.length); i++) {
        const fileInput = await page.$(`input[name="${uploadFields[i]}"]`);
        const imagePath = path.join(tmpDir, imageFiles[i]);

        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`📸 Uploaded ${imageFiles[i]} to ${uploadFields[i]}`);
          await wait(1000);
        } else {
          console.warn(`⚠️ Could not find input for ${uploadFields[i]}`);
        }
      }

      console.log(`✅ Ad filled: ${ad.title}`);
      await wait(2000);
    } catch (e) {
      console.error(`❌ Failed to post ad: ${ad.title}\nReason: ${e.message}`);
    }
  }

  await browser.close();
})();