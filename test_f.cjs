const fs = require('fs');
const path = require('path');
const https = require('https');

const TMP_DIR = path.resolve(__dirname, 'tmp_uploads');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const downloadImage = (url, filename) => {
  return new Promise((resolve, reject) => {
    const filePath = path.join(TMP_DIR, filename);
    const file = fs.createWriteStream(filePath);

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
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
      file.on('finish', () => {
        file.close(() => {
          console.log(`✅ Downloaded to: ${filePath}`);
          resolve(filePath);
        });
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => reject(err));
    });
  });
};

// ✅ Replace this with your test image
const imageUrl = 'https://media.istockphoto.com/id/825383494/photo/business-man-pushing-large-stone-up-to-hill-business-heavy-tasks-and-problems-concept.jpg?s=612x612&w=0&k=20&c=wtqvbQ6OIHitRVDPTtoT_1HKUAOgyqa7YzzTMXqGRaQ=';
const filename = `test_image_${Date.now()}.jpg`;

downloadImage(imageUrl, filename)
  .then(() => console.log('✅ Done'))
  .catch(err => console.error('❌ Error:', err.message));