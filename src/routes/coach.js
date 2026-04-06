const express = require("express");
const router = express.Router();
const openaiService = require("../services/openaiService");

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function buildHistoryText(history) {
  if (!Array.isArray(history)) return "";
  return history
    .slice(-8)
    .map((msg) => `${msg.role || "user"}: ${String(msg.content || "").trim()}`)
    .join("\n");
}

function isOpenAIDisabledOrQuotaError(err) {
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("openai")
    || message.includes("api key")
    || message.includes("quota")
    || message.includes("billing")
    || message.includes("rate limit")
    || message.includes("429")
  );
}

const INTERVIEW_TOPICS = [
  {
    label: "React",
    keywords: ["react", "redux", "state", "frontend", "hooks", "component"],
    startQuestion: "Your resume suggests React experience. Can you walk me through how you structured component state and data flow in one project?",
    followUpQuestion: "You mentioned React. Can you explain how you handled state management and why you chose that approach?",
  },
  {
    label: "Node.js APIs",
    keywords: ["node", "express", "api", "backend", "rest", "microservice"],
    startQuestion: "Tell me about a backend API you built and how you ensured reliability and performance.",
    followUpQuestion: "You mentioned backend APIs. How did you handle validation, errors, and scalability under load?",
  },
  {
    label: "Databases",
    keywords: ["sql", "database", "postgres", "mongodb", "query", "schema"],
    startQuestion: "Describe a database decision you made in a project and its impact on performance or maintainability.",
    followUpQuestion: "You mentioned database work. How did you optimize queries or schema design for better performance?",
  },
  {
    label: "Testing",
    keywords: ["test", "jest", "cypress", "qa", "unit", "integration"],
    startQuestion: "How do you test your features before shipping, and what bugs did that process help you prevent?",
    followUpQuestion: "You mentioned testing. What specific tests gave you the most confidence before release?",
  },
  {
    label: "DevOps",
    keywords: ["docker", "kubernetes", "deployment", "ci", "cd", "aws", "cloud"],
    startQuestion: "Walk me through how you deployed a project and handled reliability after release.",
    followUpQuestion: "You mentioned deployment. How did you monitor issues and recover quickly from failures?",
  },
];

function pickTopic(...texts) {
  const haystack = texts.map((value) => text(value).toLowerCase()).join(" ");
  return INTERVIEW_TOPICS.find((topic) => topic.keywords.some((kw) => haystack.includes(kw))) || null;
}

function buildFallbackStartQuestion(resumeText, jobRole) {
  const topic = pickTopic(jobRole, resumeText);
  if (topic) {
    return {
      focusArea: topic.label,
      question: topic.startQuestion,
    };
  }

  return {
    focusArea: "Project Impact",
    question: "Walk me through your strongest project and explain its measurable outcome.",
  };
}

function buildFallbackFollowUpQuestion({ answer, resumeText, jobRole }) {
  const topic = pickTopic(answer, resumeText, jobRole);
  if (topic) return topic.followUpQuestion;
  return "Can you walk me through a technical decision you made and how it affected users or business outcomes?";
}

router.post("/chat", async (req, res) => {
  try {
    const message = text(req.body?.message);
    const resumeText = text(req.body?.resumeText);
    const jobRole = text(req.body?.jobRole);
    const analysisSummary = text(req.body?.analysisSummary);
    const reviewSummary = text(req.body?.reviewSummary);
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    if (!openaiService.isConfigured()) {
      return res.json({
        reply:
          "I can still coach you, but advanced conversational guidance is limited because OPENAI_API_KEY is not configured. Add your key to unlock tailored Q&A.",
        suggestedFollowUps: [
          "What are my top 3 resume priorities for this role?",
          "How should I improve project bullets with impact metrics?",
          "Which interview question should I practice first?",
        ],
      });
    }

    try {
      const data = await openaiService.coachChat({
        resumeText,
        jobRole,
        analysisSummary,
        reviewSummary,
        history: buildHistoryText(history),
        question: message,
      });

      return res.json(data);
    } catch (err) {
      if (isOpenAIDisabledOrQuotaError(err)) {
        return res.json({
          reply:
            "Your projects show promise, but they need clearer impact framing for this role. Focus on measurable outcomes, architecture decisions, and the business/user result in each project bullet.",
          suggestedFollowUps: [
            "How should I rewrite one weak project bullet?",
            "Which project should I lead with for this role?",
            "What interview question can I expect from this project?",
          ],
          warning: "AI provider is currently unavailable or out of quota. Showing fallback coaching.",
        });
      }

      throw err;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to get coaching response." });
  }
});

router.post("/interview/start", async (req, res) => {
  try {
    const resumeText = text(req.body?.resumeText);
    const jobRole = text(req.body?.jobRole);

    if (!jobRole) {
      return res.status(400).json({ error: "jobRole is required." });
    }

    if (!openaiService.isConfigured()) {
      const fallback = buildFallbackStartQuestion(resumeText, jobRole);
      return res.json({
        coachIntro: "Interview mode started. Configure OPENAI_API_KEY for personalized role-specific questioning.",
        question: fallback.question,
        focusArea: fallback.focusArea,
      });
    }

    try {
      const data = await openaiService.startInterview({ resumeText, jobRole });
      return res.json(data);
    } catch (err) {
      if (isOpenAIDisabledOrQuotaError(err)) {
        const fallback = buildFallbackStartQuestion(resumeText, jobRole);
        return res.json({
          coachIntro: "Interview mode is running in fallback coach mode because the AI provider is unavailable right now.",
          question: fallback.question,
          focusArea: fallback.focusArea,
          warning: "AI provider is currently unavailable or out of quota. Using fallback interview questions.",
        });
      }

      throw err;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to start interview mode." });
  }
});

router.post("/interview/answer", async (req, res) => {
  try {
    const resumeText = text(req.body?.resumeText);
    const jobRole = text(req.body?.jobRole);
    const currentQuestion = text(req.body?.currentQuestion);
    const answer = text(req.body?.answer);
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!jobRole || !currentQuestion || !answer) {
      return res.status(400).json({ error: "jobRole, currentQuestion, and answer are required." });
    }

    if (!openaiService.isConfigured()) {
      const nextQuestion = buildFallbackFollowUpQuestion({ answer, resumeText, jobRole });
      return res.json({
        feedback: "Solid start. Add a clearer structure: context, action, and quantified impact.",
        score: 6,
        idealAnswerTip: "Include one measurable outcome to strengthen credibility.",
        nextQuestion,
        isComplete: false,
      });
    }

    try {
      const data = await openaiService.continueInterview({
        resumeText,
        jobRole,
        currentQuestion,
        answer,
        history: buildHistoryText(history),
      });

      return res.json(data);
    } catch (err) {
      if (isOpenAIDisabledOrQuotaError(err)) {
        const nextQuestion = buildFallbackFollowUpQuestion({ answer, resumeText, jobRole });
        return res.json({
          feedback:
            "Your answer has good intent. Make it stronger with STAR format: scenario, your action, and one quantified result.",
          score: 6,
          idealAnswerTip: "Use one metric like latency reduced, users impacted, or time saved.",
          nextQuestion,
          isComplete: false,
          warning: "AI provider is currently unavailable or out of quota. Using fallback feedback.",
        });
      }

      throw err;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to process interview answer." });
  }
});

module.exports = router;
