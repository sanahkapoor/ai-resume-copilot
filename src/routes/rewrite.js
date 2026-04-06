const express = require('express');
const router = express.Router();
const openaiService = require('../services/openaiService');
const nlpEngine = require('../services/nlpEngine');

const STRONG_VERB_PREFIXES = [
  'Built', 'Engineered', 'Designed', 'Developed', 'Implemented',
  'Optimized', 'Automated', 'Led', 'Improved', 'Delivered',
];

function pickStrongVerb(bullet) {
  const lower = String(bullet || '').toLowerCase();
  const knownVerb = STRONG_VERB_PREFIXES.find((verb) => lower.startsWith(verb.toLowerCase()));
  return knownVerb || STRONG_VERB_PREFIXES[0];
}

function fallbackRewrite(bullet, jobContext) {
  const cleanedBullet = String(bullet || '').trim().replace(/^[-•*\d.\s]+/, '');
  const cleanedContext = String(jobContext || '').trim();
  const contextKeywords = cleanedContext
    ? nlpEngine.extractKeywords(cleanedContext, 5).map((item) => item.term)
    : [];

  const keywordsAdded = contextKeywords.slice(0, 3);
  const rewritten = `${pickStrongVerb(cleanedBullet)} ${cleanedBullet.replace(/^[A-Z][a-z]+\s+/,'').replace(/\.$/, '')}`.trim();

  return {
    rewritten: rewritten.length ? rewritten : cleanedBullet,
    improvements: [
      'Strengthened the opening verb',
      keywordsAdded.length ? `Aligned wording to ${keywordsAdded.join(', ')}` : 'Kept the rewrite concise and ATS-friendly',
      'Use a quantified metric if one is available',
    ],
    keywords_added: keywordsAdded,
    mode: 'fallback',
  };
}

// POST /api/rewrite
router.post('/', async (req, res, next) => {
  try {
    const bullet = typeof req.body?.bullet === 'string' ? req.body.bullet.trim() : '';
    const jobContext = typeof req.body?.jobContext === 'string' ? req.body.jobContext.trim() : '';

    if (!bullet) {
      return res.status(400).json({ error: 'bullet is required.' });
    }

    if (!openaiService.isConfigured()) {
      return res.json({
        success: true,
        data: fallbackRewrite(bullet, jobContext),
      });
    }

    try {
      const result = await openaiService.rewriteBullet(bullet, jobContext || bullet);
      res.json({
        success: true,
        data: {
          ...result,
          mode: 'ai',
        },
      });
    } catch (aiErr) {
      res.json({
        success: true,
        data: {
          ...fallbackRewrite(bullet, jobContext),
          warning: `AI rewrite unavailable: ${aiErr.message}`,
        },
      });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;