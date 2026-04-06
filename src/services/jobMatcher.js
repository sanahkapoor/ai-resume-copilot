"use strict";

const rawJobListings = require("../../data/jobListings.json");
const JOB_LISTINGS = Array.isArray(rawJobListings) ? rawJobListings : [];

const SENIORITY_TIERS = { junior: 0, mid: 1, senior: 2 };
const SENIORITY_SIGNALS = {
  junior: ["fresher", "student", "0-1", "0-2", "graduate", "intern", "b.tech", "btech", "college"],
  mid: ["2-3 year", "3 year", "sde-1", "sde 1", "associate engineer"],
  senior: ["senior", "lead", "principal", "5+", "6+", "architect", "manager", "tech lead"],
};

function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.#+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSeniority(text) {
  const lower = normalise(text);
  for (const [tier, signals] of Object.entries(SENIORITY_SIGNALS)) {
    if (signals.some((s) => lower.includes(s))) return tier;
  }
  return "junior";
}

function estimateYears(resumeText) {
  const matches = String(resumeText || "").match(/(\d+)\+?\s*year/gi) || [];
  if (!matches.length) return 0;
  const nums = matches.map((m) => parseInt(m, 10)).filter((n) => n > 0 && n < 30);
  return nums.length ? Math.max(...nums) : 0;
}

function scoreJob(job, candidateSkillSet, candidateSeniority) {
  const { core, adjacent, bonus } = job.skills;

  const matchedCore = core.filter((s) => candidateSkillSet.has(s));
  const matchedAdjacent = adjacent.filter((s) => candidateSkillSet.has(s));
  const matchedBonus = bonus.filter((s) => candidateSkillSet.has(s));

  const missingCore = core.filter((s) => !candidateSkillSet.has(s));
  const missingAdjacent = adjacent.filter((s) => !candidateSkillSet.has(s));

  const coreScore = core.length ? (matchedCore.length / core.length) * 100 : 0;
  const adjacentScore = adjacent.length ? (matchedAdjacent.length / adjacent.length) * 100 : 0;
  const bonusScore = bonus.length ? (matchedBonus.length / bonus.length) * 100 : 0;

  const skillScore = coreScore * 0.6 + adjacentScore * 0.3 + bonusScore * 0.1;

  const candidateTierIdx = SENIORITY_TIERS[candidateSeniority] ?? 0;
  const jobTierIdx = SENIORITY_TIERS[job.seniority] ?? 0;
  const tierDiff = Math.abs(candidateTierIdx - jobTierIdx);
  const seniorityBonus = tierDiff === 0 ? 10 : tierDiff === 1 ? 4 : 0;

  const finalScore = Math.min(Math.round(skillScore + seniorityBonus), 100);
  const tier = finalScore >= 75 ? "Strong" : finalScore >= 55 ? "Good" : finalScore >= 35 ? "Partial" : "Stretch";

  const highlights = [];
  if (matchedCore.length === core.length) highlights.push(`All ${core.length} core skills matched`);
  else if (matchedCore.length > 0) highlights.push(`${matchedCore.length}/${core.length} core skills matched`);
  if (matchedAdjacent.length > 0) highlights.push(`${matchedAdjacent.length} adjacent skill${matchedAdjacent.length > 1 ? "s" : ""} matched`);
  if (matchedBonus.length > 0) highlights.push(`${matchedBonus.length} bonus skill${matchedBonus.length > 1 ? "s" : ""} matched`);
  if (tierDiff === 0) highlights.push("Seniority level aligns perfectly");

  const gaps = [];
  missingCore.forEach((s) => gaps.push({ skill: s, priority: "critical" }));
  missingAdjacent.slice(0, 3).forEach((s) => gaps.push({ skill: s, priority: "recommended" }));

  return {
    ...job,
    matchScore: finalScore,
    tier,
    scores: {
      core: Math.round(coreScore),
      adjacent: Math.round(adjacentScore),
      bonus: Math.round(bonusScore),
      seniority: seniorityBonus,
    },
    matched: {
      core: matchedCore,
      adjacent: matchedAdjacent,
      bonus: matchedBonus,
    },
    gaps,
    highlights,
    canApply: finalScore >= 35,
  };
}

class JobMatcher {
  match({ skills = [], resumeText = "", filters = {} }) {
    const startMs = Date.now();
    const candidateSkillSet = new Set(skills.map((s) => normalise(s)).filter(Boolean));
    const candidateSeniority = detectSeniority(resumeText);
    const estimatedYears = estimateYears(resumeText);

    let results = JOB_LISTINGS.map((job) => scoreJob(job, candidateSkillSet, candidateSeniority));

    if (filters.type) results = results.filter((j) => j.type === filters.type);
    if (filters.workMode === "remote") {
      results = results.filter((j) => j.remote === true);
    }
    if (filters.workMode === "onsite") {
      results = results.filter((j) => j.remote === false);
    }
    if (filters.minScore) results = results.filter((j) => j.matchScore >= filters.minScore);

    results.sort((a, b) => b.matchScore - a.matchScore);

    const summary = {
      totalJobsAnalyzed: JOB_LISTINGS.length,
      totalReturned: results.length,
      strongMatches: results.filter((j) => j.tier === "Strong").length,
      goodMatches: results.filter((j) => j.tier === "Good").length,
      partialMatches: results.filter((j) => j.tier === "Partial").length,
      candidateSeniority,
      estimatedYears,
      topMatchScore: results[0]?.matchScore ?? 0,
      avgMatchScore: results.length ? Math.round(results.reduce((s, j) => s + j.matchScore, 0) / results.length) : 0,
    };

    const skillFrequency = {};
    JOB_LISTINGS.forEach((job) => {
      [...job.skills.core, ...job.skills.adjacent].forEach((skill) => {
        if (!candidateSkillSet.has(skill)) skillFrequency[skill] = (skillFrequency[skill] || 0) + 1;
      });
    });

    const topMissingSkills = Object.entries(skillFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([skill, count]) => ({ skill, demandCount: count }));

    return {
      results,
      summary,
      topMissingSkills,
      meta: { matchingDurationMs: Date.now() - startMs },
    };
  }

  getListings() {
    return JOB_LISTINGS.map(({ id, title, company, location, type, salary, remote, seniority }) => ({
      id, title, company, location, type, salary, remote, seniority,
    }));
  }
}

module.exports = new JobMatcher();
