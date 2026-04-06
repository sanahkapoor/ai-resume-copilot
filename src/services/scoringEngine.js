"use strict";

const SIGNAL_WEIGHTS = {
  keywordDensity: 0.3,
  cosineSimilarity: 0.25,
  sectionComplete: 0.15,
  actionVerbStrength: 0.1,
  quantification: 0.1,
  seniorityAlignment: 0.1,
};

const REQUIRED_SECTIONS = [
  { label: "Contact Info", patterns: [/email|phone|linkedin|github|@/i] },
  { label: "Summary", patterns: [/summary|objective|profile|about/i] },
  { label: "Skills", patterns: [/skills?|technologies|tech stack|tools/i] },
  { label: "Experience", patterns: [/experience|work history|employment|intern/i] },
  { label: "Education", patterns: [/education|university|college|degree|b\.?tech|bachelor/i] },
  { label: "Projects", patterns: [/projects?|portfolio|built|developed/i] },
];

const STRONG_ACTION_VERBS = [
  "architected", "automated", "built", "collaborated", "configured", "containerized",
  "debugged", "delivered", "deployed", "designed", "developed", "engineered",
  "enhanced", "established", "implemented", "improved", "integrated", "launched",
  "led", "migrated", "modelled", "optimised", "optimized", "orchestrated",
  "pioneered", "reduced", "refactored", "released", "scaled", "shipped", "solved",
  "streamlined", "tested", "trained", "transformed", "upgraded", "wrote",
];

const WEAK_PHRASES = [
  "responsible for", "worked on", "helped with", "assisted in",
  "participated in", "involved in", "part of", "contributed to",
];

const SENIORITY_MAP = {
  junior: ["junior", "entry level", "fresher", "0-1 year", "0-2 year", "graduate", "trainee"],
  mid: ["mid level", "2-4 year", "3 year", "associate", "software engineer", "sde-1", "sde 1"],
  senior: ["senior", "lead", "principal", "staff", "5+ year", "6+ year", "architect", "manager"],
};

function clamp(v, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, v));
}

function roundPct(v) {
  return Math.round(clamp(v * 100));
}

function words(text) {
  return (text || "").toLowerCase().match(/\b[a-z][a-z+#.-]{1,}/g) || [];
}

function keywordDensitySignal(resumeTokens, jobKeywords) {
  if (!jobKeywords.length) return { raw: 0, score: 0, detail: {} };

  const resumeSet = new Set(resumeTokens);
  const matched = jobKeywords.filter((k) => resumeSet.has(k));
  const missing = jobKeywords.filter((k) => !resumeSet.has(k));
  const raw = matched.length / jobKeywords.length;

  return {
    raw,
    score: roundPct(raw),
    detail: {
      totalJobKeywords: jobKeywords.length,
      matchedCount: matched.length,
      missingCount: missing.length,
      matchedKeywords: matched,
      missingKeywords: missing.slice(0, 15),
    },
  };
}

function cosineSimilaritySignal(resumeVec, jobVec) {
  const allTerms = new Set([...Object.keys(resumeVec), ...Object.keys(jobVec)]);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const t of allTerms) {
    const a = resumeVec[t] || 0;
    const b = jobVec[t] || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }

  const similarity = magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;

  return {
    raw: similarity,
    score: roundPct(similarity),
    detail: { cosineSimilarity: Number(similarity.toFixed(4)) },
  };
}

function sectionCompletenessSignal(resumeText) {
  const results = REQUIRED_SECTIONS.map((section) => {
    const found = section.patterns.some((p) => p.test(resumeText));
    return { section: section.label, found };
  });

  const foundCount = results.filter((r) => r.found).length;
  const raw = foundCount / REQUIRED_SECTIONS.length;

  return {
    raw,
    score: roundPct(raw),
    detail: { sections: results, foundCount, totalExpected: REQUIRED_SECTIONS.length },
  };
}

function actionVerbSignal(resumeText) {
  const lower = resumeText.toLowerCase();
  const strongHits = STRONG_ACTION_VERBS.filter((v) => lower.includes(v));
  const weakHits = WEAK_PHRASES.filter((p) => lower.includes(p));

  const strongScore = Math.min(strongHits.length / 10, 1);
  const penalty = Math.min(weakHits.length * 0.08, 0.4);
  const raw = Math.max(strongScore - penalty, 0);

  return {
    raw,
    score: roundPct(raw),
    detail: {
      strongVerbsFound: strongHits,
      weakPhrasesFound: weakHits,
      strongVerbCount: strongHits.length,
      weakPhraseCount: weakHits.length,
    },
  };
}

function quantificationSignal(resumeText) {
  const lines = resumeText.split("\n").map((l) => l.trim()).filter((l) => l.length > 15);
  const bulletLines = lines.filter((l) => /^[\u2022\-*\d]/.test(l) || l.length < 120);
  if (!bulletLines.length) return { raw: 0, score: 0, detail: { quantifiedLines: 0, totalLines: 0 } };

  const numberRe = /\d[\d,.]*(k|m|%|\+|x|ms|s|hrs?|days?|weeks?|users?|requests?|queries?)?\b/i;
  const quantified = bulletLines.filter((l) => numberRe.test(l));
  const raw = quantified.length / bulletLines.length;

  return {
    raw,
    score: roundPct(raw),
    detail: {
      quantifiedLines: quantified.length,
      totalBulletLines: bulletLines.length,
      examples: quantified.slice(0, 3).map((l) => l.slice(0, 90)),
    },
  };
}

function seniorityAlignmentSignal(resumeText, jobText) {
  const detect = (text, map) => {
    const lower = text.toLowerCase();
    for (const [tier, terms] of Object.entries(map)) {
      if (terms.some((t) => lower.includes(t))) return tier;
    }
    return "mid";
  };

  const resumeTier = detect(resumeText, SENIORITY_MAP);
  const jobTier = detect(jobText, SENIORITY_MAP);
  const tiers = ["junior", "mid", "senior"];
  const diff = Math.abs(tiers.indexOf(resumeTier) - tiers.indexOf(jobTier));
  const raw = diff === 0 ? 1 : diff === 1 ? 0.6 : 0.2;

  return {
    raw,
    score: roundPct(raw),
    detail: { resumeTier, jobTier, tierDifference: diff },
  };
}

function improvementTip(signal, score) {
  const tips = {
    keywordDensity:
      score < 60
        ? "Add missing JD keywords in Skills and experience bullets."
        : "Good keyword coverage. Keep terms in natural context.",
    cosineSimilarity:
      score < 50
        ? "Tailor summary and project bullets closer to JD wording."
        : "Use more exact role phrases where natural.",
    sectionComplete:
      score < 100
        ? "Include standard sections like Summary, Skills, and Projects."
        : "All standard ATS sections are present.",
    actionVerbStrength:
      score < 60
        ? "Replace weak phrasing with strong action verbs."
        : "Verb quality is strong. Remove any remaining weak phrasing.",
    quantification:
      score < 50
        ? "Add metrics: percentages, volumes, latency, or impact counts."
        : "Good quantification. Add metrics to remaining lines.",
    seniorityAlignment:
      score < 60
        ? "Adjust seniority signals to better match the target role."
        : "Seniority cues align well with the role.",
  };

  return tips[signal] || "Review this signal for improvement opportunities.";
}

class ScoringEngine {
  score({ resumeText, jobText, jobKeywords, resumeVec, jobVec }) {
    const startMs = Date.now();
    const resumeTokens = words(resumeText);

    const signals = {
      keywordDensity: keywordDensitySignal(resumeTokens, jobKeywords),
      cosineSimilarity: cosineSimilaritySignal(resumeVec, jobVec),
      sectionComplete: sectionCompletenessSignal(resumeText),
      actionVerbStrength: actionVerbSignal(resumeText),
      quantification: quantificationSignal(resumeText),
      seniorityAlignment: seniorityAlignmentSignal(resumeText, jobText),
    };

    let weightedSum = 0;
    const breakdown = {};

    for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
      const signal = signals[key];
      const weightedScore = signal.raw * weight * 100;
      weightedSum += weightedScore;
      breakdown[key] = {
        weight: Math.round(weight * 100),
        rawScore: signal.score,
        weightedScore: Number(weightedScore.toFixed(2)),
        detail: signal.detail,
      };
    }

    const atsScore = clamp(Math.round(weightedSum), 0, 100);

    const grade =
      atsScore >= 85
        ? { label: "Excellent", color: "green", advice: "Strong match. Apply with confidence." }
        : atsScore >= 70
        ? { label: "Good", color: "teal", advice: "Good match. Minor tweaks will help." }
        : atsScore >= 55
        ? { label: "Fair", color: "amber", advice: "Moderate match. Address top skill gaps." }
        : { label: "Weak", color: "red", advice: "Low match. Significant keyword gaps exist." };

    const improvements = Object.entries(breakdown)
      .map(([key, b]) => ({
        signal: key,
        gap: b.weight - b.weightedScore,
        rawScore: b.rawScore,
        weight: b.weight,
      }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3)
      .map(({ signal, rawScore, weight }) => ({
        signal,
        currentScore: rawScore,
        maxPoints: weight,
        tip: improvementTip(signal, rawScore),
      }));

    return {
      atsScore,
      grade,
      breakdown,
      improvements,
      weights: SIGNAL_WEIGHTS,
      meta: { scoringDurationMs: Date.now() - startMs },
    };
  }
}

module.exports = new ScoringEngine();
