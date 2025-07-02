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

// Enable Puppeteer stealth mode to avoid bot detection
puppeteer.use(StealthPlugin());

// Utility function to wait for a specified number of milliseconds
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility function to pause execution until the user presses Enter
const waitForEnter = () => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('🔐 Press Enter once logged in...', () => {
    rl.close();
    resolve();
  });
});

// Initialize the OpenAI ChatGPT API with the provided API key
const openai = new ChatGPTAPI({ apiKey: process.env.OPENAI_API_KEY });

// Define the path to the temporary uploads directory
const TMP_DIR = path.resolve(__dirname, 'tmp_uploads');
// Ensure the tmp_uploads directory exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Function to clear all files in the tmp_uploads directory before each ad upload
function clearTmpUploads() {
  if (fs.existsSync(TMP_DIR)) {
    fs.readdirSync(TMP_DIR).forEach(file => fs.unlinkSync(path.join(TMP_DIR, file)));
  }
}

// Function to get a category suggestion from ChatGPT based on ad title and description
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

// Function to download an image from a URL and save it to the tmp_uploads directory
function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(TMP_DIR, filename);
    const file = fs.createWriteStream(filePath);

    // Set headers to mimic a real browser request
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    };

    // Start the HTTPS GET request
    https.get(url, options, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Response status: ${response.statusCode}`));
        return;
      }
      // Pipe the response data to the file
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          console.log(`✅ Downloaded to: ${filePath}`);
          resolve(filePath);
        });
      });
    }).on('error', (err) => {
      // Remove the file if there was an error
      fs.unlink(filePath, () => reject(err));
    });
  });
}

// Main async IIFE to run the automation
(async () => {
  // Load ads and categories from JSON files
  const ads = JSON.parse(fs.readFileSync('full_details.json', 'utf-8'));
  const categories = JSON.parse(fs.readFileSync('adverts_categories.json', 'utf-8'));
  const categoryList = Object.keys(categories);

  // Launch Puppeteer browser in non-headless mode for manual login and debugging
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Listen for browser dialogs and automatically accept them
  page.on('dialog', async dialog => {
    console.log('⚠️ Dialog shown:', dialog.message());
    await dialog.accept();
  });

  // Navigate to the adverts.ie sell page and wait for manual login
  await page.goto('https://www.adverts.ie/sell', { waitUntil: 'domcontentloaded' });
  await waitForEnter();

  // Loop through each ad in the ads array
  for (const ad of ads) {
    try {
      // Clear temporary uploads before each ad
      clearTmpUploads();
      console.log(`➡️ Preparing to post: ${ad.title}`);

      // Go to the sell page again for each ad
      await page.goto('https://www.adverts.ie/sell', { waitUntil: 'domcontentloaded' });
      // Wait for the title input to appear
      await page.waitForSelector('input[name="title"]');
      // Type a test prefix and the ad title
      await page.type('input[name="title"]', 'AUTOTEST_' + ad.title);

      // Get a suggested category from ChatGPT
      const suggestedCategory = await getCategorySuggestion(ad.title, ad.description, categoryList);
      console.log(`📂 GPT Suggested Category: ${suggestedCategory}`);

      // If a category is suggested, try to select it on the page
      if (suggestedCategory) {
        await page.evaluate((catName) => {
          const links = Array.from(document.querySelectorAll('.category-holder a'));
          const match = links.find(el => el.textContent.trim() === catName);
          if (match) match.click();
        }, suggestedCategory);
        await wait(1500); // Wait for the UI to update
      }

      // Fallback: Try to select the 'Other' category if available
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('.category-holder a'));
        const match = links.find(el => el.textContent.toLowerCase().includes('other'));
        if (match) match.click();
      });

      // Wait for navigation to the next step after category selection
      await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
      // Wait for the title input again (new form step)
      await page.waitForSelector('input[name="title"]');
      // Clear the title field and type the real ad title
      await page.evaluate(() => document.querySelector('input[name="title"]').value = '');
      await page.type('input[name="title"]', ad.title);
      // Fill in the ad description
      await page.type('textarea[name="description"]', ad.description);

      // Click the 'Brand New' checkbox if it exists
      const brandCheckbox = await page.$('#brand_new');
      if (brandCheckbox) await brandCheckbox.click();

      // Clean the price string and type it in
      const cleanPrice = ad.price.toString().replace(/[^\d.]/g, '');
      await page.type('input[name="price"]', cleanPrice);

      // Select shipping options by clicking the appropriate labels
      const shippingOptions = ['Delivery', 'Post/Courier'];
      for (const label of shippingOptions) {
        await page.evaluate((text) => {
          const labelEl = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes(text));
          if (labelEl) labelEl.click();
        }, label);
      }

      // Select payment options by clicking the appropriate labels
      const payments = ['Paypal', 'Bank Transfer', 'To be arranged'];
      for (const label of payments) {
        await page.evaluate((text) => {
          const labelEl = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes(text));
          if (labelEl) labelEl.click();
        }, label);
      }

      // Switch to Basic Uploader if available (for fallback/manual upload)
      await page.evaluate(() => {
        const toggle = document.querySelector('.js-switch-to-basic-action');
        if (toggle) toggle.click();
      });
      await wait(1000); // Wait for the uploader to switch

      // Download all images for this ad to the tmp_uploads directory
      const imageUrls = ad.images || [];
      const localImagePaths = [];
      for (let i = 0; i < Math.min(imageUrls.length, 5); i++) {
        try {
          // Generate a unique filename for each image
          const filename = `upload_${Date.now()}_${i}.jpg`;
          // Download the image and store the local path
          const filePath = await downloadImage(imageUrls[i], filename);
          localImagePaths.push(filePath);
        } catch (err) {
          // Warn if an image fails to download
          console.warn(`⚠️ Failed to download image ${imageUrls[i]}: ${err.message}`);
        }
      }

      // Try to upload all images using the advanced uploader (multiple file input)
      const advancedInput = await page.$('input[type="file"][multiple]');
      if (advancedInput) {
        // Upload all downloaded images at once
        await advancedInput.uploadFile(...localImagePaths);
        console.log(`📸 Uploaded ${localImagePaths.length} images via advanced uploader`);
        await wait(3000); // Allow previews and ajax processing
      } else {
        // Warn if the advanced uploader is not found
        console.warn('⚠️ Could not find advanced uploader input field');
      }

      // --- Basic Uploader logic (commented out for now) ---
      /*
      // Step 2: Upload images to correct fields and trigger change event
      const uploadFields = ['file1', 'file2', 'file3', 'file4', 'file5'];
      for (let i = 0; i < Math.min(localImagePaths.length, uploadFields.length); i++) {
        const fileInput = await page.$(`input[name="${uploadFields[i]}"]`);
        if (fileInput) {
          await fileInput.uploadFile(localImagePaths[i]);
          console.log(`📸 Uploaded ${path.basename(localImagePaths[i])} to ${uploadFields[i]}`);
          // Trigger change event so Adverts.ie reacts to the file upload
          await page.evaluate((fieldName) => {
            const input = document.querySelector(`input[name="${fieldName}"]`);
            if (input) {
              const event = new Event('change', { bubbles: true });
              input.dispatchEvent(event);
            }
          }, uploadFields[i]);
          await wait(1500); // Let the preview image render
        } else {
          console.warn(`⚠️ Could not find input for ${uploadFields[i]}`);
        }
      }
      */

      // Click the Not Sell faster button if available
      const noFasterLabel = await page.$('label[for="donedeal_paid_share_no"]');
      if (noFasterLabel) {
        await noFasterLabel.click();
        console.log('🚫 Selected: No, I don\'t want to sell faster');
      } else {
        console.warn('⚠️ Could not find the "don\'t want to sell faster" option');
      }

      // Click the "Post Ad" button to submit the form
      const finishButton = await page.$('input#btn-save');
      if (finishButton) {
        await finishButton.click();
        console.log('🏁 Clicked Finish to submit the ad');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
      } else {
        console.warn('⚠️ Could not find Finish button');
      }

      // Log success for this ad
      console.log(`✅ Ad filled: ${ad.title}`);
      await wait(2000); // Wait before next ad
    } catch (e) {
      // Log any errors that occur during the ad posting process
      console.error(`❌ Failed to post ad: ${ad.title}\nReason: ${e.message}`);
    }
  }

  // Close the browser after all ads are processed
  await browser.close();
})();
