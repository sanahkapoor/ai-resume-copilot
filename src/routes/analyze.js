const express = require('express');
const router = express.Router();
const pdfParser = require('../services/pdfParser');
const nlpEngine = require('../services/nlpEngine');
const openaiService = require('../services/openaiService');
const scoringEngine = require('../services/scoringEngine');
const jobMatcher = require('../services/jobMatcher');
const upload = require('../middleware/upload');

function getTextField(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMinScore(value, fallback = 35) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// POST /api/analyze
router.post('/', upload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Resume file is required.' });
    }

    const resumeText = await pdfParser.extract(req.file.buffer);
    const jobDescription = getTextField(req.body?.jobDescription);
    const jobType = getTextField(req.body?.jobType).toLowerCase();
    const minScore = parseMinScore(req.body?.minScore, 35);
    const includeAI = String(req.body?.includeAI || 'true').toLowerCase() !== 'false';
    const baseResponse = {
      success: true,
      preview: resumeText.slice(0, 500),
      resumeTextForAI: resumeText.slice(0, 6000),
      wordCount: resumeText.split(/\s+/).length,
    };

    const candidateSkills = nlpEngine.extractKeywords(resumeText, 45).map((k) => k.term);
    const jobMatches = jobMatcher.match({
      skills: candidateSkills,
      resumeText,
      filters: {
        workMode: jobType || 'hybrid',
        minScore,
      },
    });

    if (!jobDescription) {
      return res.json({
        ...baseResponse,
        jobMatches,
        note: 'Add a job description to get ATS score, matched keywords, and missing keywords.',
      });
    }

    const nlpResult = nlpEngine.analyze(resumeText, jobDescription);
    const resumeVec = nlpEngine.buildTFIDFVector(resumeText);
    const jobVec = nlpEngine.buildTFIDFVector(jobDescription);
    const jobKeywords = nlpEngine.extractKeywords(jobDescription, 40).map((k) => k.term);

    const advancedScoring = scoringEngine.score({
      resumeText,
      jobText: jobDescription,
      jobKeywords,
      resumeVec,
      jobVec,
    });

    let aiAnalysis = null;
    let aiResumeReview = null;
    let aiResumeRewriteSuggestions = null;
    let keywordSuggestions = null;
    let aiInsights = null;
    let aiWarning = null;

    if (includeAI) {
      if (!openaiService.isConfigured()) {
        aiWarning = 'OPENAI_API_KEY is not set. Returning NLP analysis only.';
        aiResumeRewriteSuggestions = openaiService.rewriteResumePointsFallback(resumeText);
      } else {
        try {
          aiResumeReview = await openaiService.analyzeResume(
            resumeText,
            jobDescription
          );
          aiResumeRewriteSuggestions = await openaiService.rewriteResumePoints(resumeText);
          aiAnalysis = await openaiService.analyzeSkillGap(
            resumeText,
            jobDescription,
            nlpResult.missingKeywords,
            advancedScoring.atsScore
          );
          keywordSuggestions = await openaiService.suggestKeywords(
            jobDescription,
            nlpResult.matchedKeywords
          );
          aiInsights = await openaiService.generateInsights(resumeText, jobDescription, nlpResult);
        } catch (aiErr) {
          aiWarning = `AI insights unavailable: ${aiErr.message}`;
          aiResumeRewriteSuggestions = openaiService.rewriteResumePointsFallback(resumeText);
        }
      }
    }

    res.json({
      ...baseResponse,
      analysis: nlpResult,
      advancedScoring,
      jobMatches,
      aiAnalysis,
      aiResumeReview,
      aiResumeRewriteSuggestions,
      keywordSuggestions,
      aiInsights,
      aiWarning,
    });
  } catch (err) {
    const message = err?.message || 'Failed to analyze resume.';
    res.status(500).json({ error: message });
  }
});

module.exports = router;