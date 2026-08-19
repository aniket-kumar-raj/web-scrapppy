const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// Local Keyless Summarizer (No API Key or Age Limits Required)
function getLocalSummary(fullText, title, description) {
  const content = fullText || description;
  
  if (!content || content.length < 40) {
    return `• Page Title: ${title}\n• Quick Overview: No detailed text content was found to summarize.`;
  }

  const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
  
  const keySentences = sentences
    .map(s => s.trim())
    .filter(s => s.length > 35 && s.length < 220)
    .slice(0, 3);

  if (keySentences.length === 0) {
    return `• Overview: ${content.slice(0, 200)}...`;
  }

  return keySentences.map(sentence => `• ${sentence}`).join('\n');
}

app.post('/api/scrape', async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    const title = $('title').text().trim() || 'Untitled Page';
    const description = $('meta[name="description"]').attr('content') 
                     || $('meta[property="og:description"]').attr('content') 
                     || '';

    let paragraphs = [];
    $('p, article, section').each((_, el) => {
      const txt = $(el).text().trim();
      if (txt.length > 30) paragraphs.push(txt);
    });

    const fullPageText = paragraphs.join(' ');

    const navLinks = [];
    $('nav a, header a').each((_, el) => {
      const txt = $(el).text().trim();
      if (txt && txt.length < 25 && !navLinks.includes(txt)) {
        navLinks.push(txt);
      }
    });

    // Security & Trust Scoring
    let score = 25;
    const indicators = [];

    if (isHttps) {
      score += 25;
      indicators.push({ text: 'SSL Encrypted (HTTPS)', pass: true });
    } else {
      indicators.push({ text: 'Insecure HTTP Connection', pass: false });
    }

    if (description) {
      score += 20;
      indicators.push({ text: 'Valid Meta Description', pass: true });
    } else {
      indicators.push({ text: 'Missing Search Metadata', pass: false });
    }

    let hasContactAbout = false;
    let hasLegal = false;

    $('a').each((_, el) => {
      const href = ($(el).attr('href') || '').toLowerCase();
      const txt = $(el).text().toLowerCase();

      if (href.includes('about') || href.includes('contact') || txt.includes('about') || txt.includes('contact')) {
        hasContactAbout = true;
      }
      if (href.includes('privacy') || href.includes('terms') || txt.includes('privacy') || txt.includes('terms')) {
        hasLegal = true;
      }
    });

    if (hasContactAbout) {
      score += 15;
      indicators.push({ text: 'Found About/Contact Links', pass: true });
    } else {
      indicators.push({ text: 'No About/Contact Pages Detected', pass: false });
    }

    if (hasLegal) {
      score += 15;
      indicators.push({ text: 'Found Privacy/Terms Policy', pass: true });
    } else {
      indicators.push({ text: 'Missing Privacy or Terms Pages', pass: false });
    }

    score = Math.min(100, Math.max(0, score));
    let rating = 'Verified / Low Risk';
    let color = '#10b981';

    if (score < 45) {
      rating = 'High Suspicion Risk';
      color = '#f43f5e';
    } else if (score < 70) {
      rating = 'Moderate Caution Required';
      color = '#f59e0b';
    }

    const aiSummary = getLocalSummary(fullPageText, title, description);

    res.json({
      success: true,
      domain: parsedUrl.hostname,
      title,
      description,
      navLinks: navLinks.slice(0, 8),
      aiSummary,
      trust: { score, rating, color, indicators }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Scrape failed: ' + error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server live on http://localhost:${PORT}`);
});