// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const { ChatGPTAPI } = require('chatgpt');
const https = require('https');

// Constants
const TMP_DIR = path.resolve(__dirname, 'tmp_uploads');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Enable Puppeteer stealth mode
puppeteer.use(StealthPlugin());

// Utility: wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: wait for Enter after login
const waitForEnter = () => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('🔐 Press Enter once logged in...\n', () => {
    rl.close();
    resolve();
  });
});

// GPT setup
const openai = new ChatGPTAPI({ apiKey: process.env.OPENAI_API_KEY });

// Utility: clear tmp_uploads folder
function clearTmpUploads() {
  fs.readdirSync(TMP_DIR).forEach(file => fs.unlinkSync(path.join(TMP_DIR, file)));
}

// Utility: download image from URL to tmp_uploads
function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(TMP_DIR, filename);
    const file = fs.createWriteStream(filePath);

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    };

    https.get(url, options, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Response status: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(filePath)));
    }).on('error', (err) => {
      fs.unlink(filePath, () => reject(err));
    });
  });
}

// GPT category suggestion
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

// Main logic
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
      console.log(`➡️ Preparing to post: ${ad.title}`);
      clearTmpUploads();

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

      // Fallback to "Other"
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

      // Switch to basic uploader
      await page.evaluate(() => {
        const toggle = document.querySelector('.js-switch-to-basic-action');
        if (toggle) toggle.click();
      });
      await wait(1000);

      // Download image files
      const imageUrls = ad.images || [];
      for (let i = 0; i < Math.min(imageUrls.length, 5); i++) {
        try {
          const ext = path.extname(new URL(imageUrls[i]).pathname).split('?')[0] || '.jpg';
          const filename = `image_${i}_${Date.now()}${ext}`;
          await downloadImage(imageUrls[i], filename);
        } catch (err) {
          console.warn(`⚠️ Failed to download image ${imageUrls[i]}: ${err.message}`);
        }
      }

      // Upload images
      const uploadableImages = fs.readdirSync(TMP_DIR).filter(f => /\.(jpe?g|png)$/i.test(f));
      const uploadFields = ['file1', 'file2', 'file3', 'file4', 'file5'];

      for (let i = 0; i < Math.min(uploadableImages.length, uploadFields.length); i++) {
        const fileInput = await page.$(`input[name="${uploadFields[i]}"]`);
        const imagePath = path.join(TMP_DIR, uploadableImages[i]);

        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`📸 Uploaded ${uploadableImages[i]} to ${uploadFields[i]}`);
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