const OpenAI = require('openai');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function extractJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('OpenAI returned an empty response.');
  }

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  return JSON.parse(cleaned);
}

function truncateText(text, maxChars) {
  if (typeof text !== 'string') return '';
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function extractResumeBullets(resumeText) {
  const text = String(resumeText || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*\u2022\u25e6\u25aa\u25cf]+\s*/, '').trim())
    .filter((line) => line.length >= 18);

  const sentenceCandidates = /[.!?]/.test(text)
    ? text
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 28 && sentence.split(/\s+/).length <= 20)
    : [];

  const combined = [...lines, ...sentenceCandidates]
    .filter((item) => !/^(experience|projects|education|skills|summary|contact|profile|objective)$/i.test(item))
    .filter((item, index, arr) => arr.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index)
    .filter((item) => item.split(/\s+/).length <= 20)
    .filter((item) => /\b(built|worked|helped|managed|created|developed|implemented|designed|handled|improved|supported|led|collaborated|maintained|deployed|optimized|engineered|delivered|shipped|resolved|automated|reduced|increased|scaled)\b/i.test(item) || /\b(react|node|javascript|typescript|python|sql|api|frontend|backend|database|mongodb|postgres|aws|ui|ux|web)\b/i.test(item));

  return combined.slice(0, 5);
}

function rewriteBulletHeuristically(original) {
  const normalized = String(original || '').trim();
  const lower = normalized.toLowerCase();

  if (!normalized) return null;

  if (lower.includes('react') && (lower.includes('website') || lower.includes('web app') || lower.includes('application'))) {
    return `Developed a responsive React application with a polished UI, improving user engagement and delivering a more scalable frontend experience.`;
  }

  if ((lower.includes('backend') || lower.includes('api')) && (lower.includes('node') || lower.includes('rest'))) {
    return `Designed and implemented RESTful APIs using Node.js, improving data flow reliability and backend efficiency.`;
  }

  if (lower.includes('database') || lower.includes('sql') || lower.includes('mongodb') || lower.includes('postgres')) {
    return `Optimized data handling and storage workflows, improving query performance and making the application more reliable at scale.`;
  }

  if (lower.includes('team') || lower.includes('collaborat') || lower.includes('agile')) {
    return `Collaborated with cross-functional stakeholders to deliver production-ready features on time while improving overall product quality.`;
  }

  return `Improved the ${normalized.replace(/[.]+$/, '')} to better communicate impact, technical depth, and measurable outcomes.`;
}

function makeGenericRewrite(original) {
  const normalized = String(original || '').trim();
  if (!normalized) return null;

  const summary = normalized.replace(/^([A-Z][a-z]+\s*){1,4}\s*-?\s*/g, '').replace(/[.]+$/, '');
  return `Strengthened ${summary} by making the outcome, scope, and technical contribution more explicit.`;
}

const PROMPTS = {
  rewriteResumePoints: (resumeText) => `
You are an expert resume writer and AI engineer.

TASK:
Read the resume text below, identify 3 to 5 weak bullet points from experience or projects, and rewrite them into strong, concise, impact-driven statements.

RESUME TEXT:
${truncateText(resumeText, 4200)}

RULES:
- Focus on bullets from Projects and Experience sections when possible.
- Rewrite only weak, vague, or low-impact bullets.
- Use strong action verbs.
- Add realistic quantified impact only when the resume supports it or when a conservative, believable estimate is appropriate.
- Keep rewritten bullets concise, professional, and recruiter-level.
- Avoid generic wording like "worked on" or "helped with".
- Do not invent technologies that are not implied by the resume.

Return ONLY valid JSON as an array of objects with this exact structure:
[
  {
    "original": "Built a website using React",
    "improved": "Developed a responsive React application that improved user engagement by 30% and reduced page load time by 20%"
  }
]

If the resume does not contain weak bullets, return an empty array.
`,

  analyzeResumeReview: (resumeText, jobRole) => `
You are a senior technical recruiter and resume reviewer for top product companies.

TASK:
Review the candidate resume against the target role and provide concrete, evidence-based feedback.

TARGET ROLE / JOB CONTEXT:
${truncateText(jobRole, 1800)}

RESUME TEXT:
${truncateText(resumeText, 4200)}

QUALITY BAR:
- Be specific and reference observable signals from the resume.
- Avoid generic advice like "improve formatting" unless tied to a concrete issue.
- Prioritize impact, relevance to role, and clarity.
- Rewritten points must be impact-driven and ATS-friendly.

Return ONLY valid JSON with this exact schema:
{
  "score": 8.4,
  "summary": "2-4 sentence recruiter-style summary.",
  "strengths": ["specific strength 1", "specific strength 2", "specific strength 3"],
  "weaknesses": ["specific weakness 1", "specific weakness 2", "specific weakness 3"],
  "improvements": ["actionable improvement 1", "actionable improvement 2", "actionable improvement 3"],
  "rewritten_points": [
    {
      "before": "weak original bullet or inferred weak phrasing",
      "after": "strong impact-oriented rewrite",
      "why": "what improved and why"
    }
  ]
}

Rules:
- "score" must be a number from 1 to 10 (one decimal allowed).
- Provide 3 to 6 items for strengths, weaknesses, improvements.
- Provide 2 to 3 rewritten_points.
- Keep each list item concise but meaningful.
`,

  analyzeSkillGap: (resumeText, jobText, missingKeywords, atsScore) => `
You are an expert ATS consultant and career coach.

RESUME:
${truncateText(resumeText, 3000)}

JOB DESCRIPTION:
${truncateText(jobText, 2000)}

CURRENT ATS SCORE: ${typeof atsScore === 'number' ? atsScore : 'unknown'}
MISSING KEYWORDS DETECTED: ${missingKeywords.join(', ')}

Respond ONLY in valid JSON with this exact structure:
{
  "skillGaps": [
    { "skill": "Docker", "importance": "critical", "suggestion": "Add a bullet mentioning Docker in your projects" }
  ],
  "improvements": [
    "Move your skills section above experience for ATS scanners",
    "Add quantified metrics to at least 3 more bullet points"
  ],
  "strongPoints": [
    "Good use of action verbs in experience bullets",
    "Relevant tech stack clearly listed"
  ],
  "summary": "Your resume matches 62% of requirements. Focus on adding cloud and DevOps keywords."
}`,

  rewriteBullet: (bullet, jobContext) => `
You are an expert resume writer specializing in ATS optimization.

ORIGINAL BULLET: "${bullet}"
TARGET ROLE CONTEXT: ${jobContext}

Rewrite this bullet point to:
1. Start with a strong past-tense action verb
2. Include a quantifiable metric (estimate if not provided)
3. Incorporate relevant technical keywords naturally
4. Keep it under 20 words
5. Make it ATS-friendly

Respond ONLY in valid JSON:
{
  "rewritten": "Engineered REST API handling 10K+ daily requests using Node.js, reducing latency by 40%",
  "improvements": ["Added metric", "Stronger verb", "Added REST API keyword"],
  "keywords_added": ["REST API", "Node.js"]
}`,

  suggestKeywords: (jobText, currentSkills) => `
You are an ATS optimization expert.

JOB DESCRIPTION:
${truncateText(jobText, 2000)}

CANDIDATE'S CURRENT SKILLS: ${currentSkills.join(', ')}

Identify the top 10 ATS keywords the candidate should add to their resume.
Prioritize: exact JD phrases, in-demand tech terms, action verbs.

Respond ONLY in valid JSON:
{
  "critical": ["Docker", "CI/CD", "Agile"],
  "recommended": ["REST API", "microservices", "PostgreSQL"],
  "niceToHave": ["Kubernetes", "Terraform"],
  "reasoning": "The JD emphasizes DevOps practices 8 times..."
}`,

  combinedInsights: (resumeText, jobText, analysis) => `
You are an expert ATS resume coach.

RESUME TEXT:
${truncateText(resumeText, 2800)}

JOB DESCRIPTION:
${truncateText(jobText, 2200)}

CURRENT ANALYSIS SNAPSHOT:
${JSON.stringify(analysis)}

Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence coaching summary",
  "priorityActions": [
    "Top action 1",
    "Top action 2",
    "Top action 3"
  ],
  "improvedSkillsSection": ["keyword1", "keyword2", "keyword3"],
  "bulletRewriteIdeas": [
    "Action-focused bullet rewrite 1",
    "Action-focused bullet rewrite 2"
  ]
}
Keep responses concise, specific, and ATS-focused.
`,

  coachChat: ({ resumeText, jobRole, analysisSummary, reviewSummary, history, question }) => `
You are an AI Career Coach. Speak like a thoughtful human mentor: clear, warm, and direct.

CONTEXT:
- Target role: ${truncateText(jobRole, 1200)}
- Resume: ${truncateText(resumeText, 3200)}
- Existing analysis summary: ${truncateText(analysisSummary, 900)}
- Existing AI review summary: ${truncateText(reviewSummary, 900)}

CHAT HISTORY:
${truncateText(history, 2000)}

USER QUESTION:
${truncateText(question, 1000)}

Return ONLY valid JSON:
{
  "reply": "A conversational, role-specific coaching response in 4-8 sentences.",
  "suggestedFollowUps": ["follow-up question 1", "follow-up question 2", "follow-up question 3"]
}

Rules:
- Avoid generic advice.
- Reference resume/job specifics when possible.
- End with one practical next action.
`,

  interviewStart: ({ resumeText, jobRole }) => `
You are an AI Interview Coach preparing a candidate for ${truncateText(jobRole, 600)}.

Candidate resume context:
${truncateText(resumeText, 2600)}

Return ONLY valid JSON:
{
  "coachIntro": "2-3 sentence motivating intro and expectations.",
  "question": "First interview question tailored to role and resume.",
  "focusArea": "short focus area label"
}
`,

  interviewTurn: ({ resumeText, jobRole, currentQuestion, answer, history }) => `
You are an AI Interview Coach giving immediate feedback.

ROLE:
${truncateText(jobRole, 900)}

RESUME CONTEXT:
${truncateText(resumeText, 2400)}

CURRENT QUESTION:
${truncateText(currentQuestion, 700)}

CANDIDATE ANSWER:
${truncateText(answer, 1600)}

RECENT INTERVIEW HISTORY:
${truncateText(history, 1800)}

Return ONLY valid JSON:
{
  "feedback": "Specific, constructive feedback in 3-6 sentences.",
  "score": 7,
  "idealAnswerTip": "One concrete improvement tip for this answer.",
  "nextQuestion": "Next tailored interview question.",
  "isComplete": false
}

Rules:
- score is integer 1-10.
- Keep feedback specific to answer quality.
- Ask progressively deeper follow-up questions.
- Set isComplete true only when 5+ rounds appear completed in history.
`,
};

class OpenAIService {
  constructor() {
    this.client = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
  }

  isConfigured() {
    return Boolean(this.client);
  }

  async callJson(prompt, { temperature = 0.3, max_tokens = 900 } = {}) {
    if (!this.client) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY in your environment.');
    }

    const response = await this.client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens,
      response_format: { type: 'json_object' },
    });

    const content = response?.choices?.[0]?.message?.content;
    return extractJson(content);
  }

  async analyzeSkillGap(resumeText, jobText, missingKeywords, atsScore) {
    return this.callJson(
      PROMPTS.analyzeSkillGap(resumeText, jobText, missingKeywords, atsScore),
      { temperature: 0.3, max_tokens: 1000 }
    );
  }

  async analyzeResume(resumeText, jobRole) {
    const review = await this.callJson(PROMPTS.analyzeResumeReview(resumeText, jobRole), {
      temperature: 0.35,
      max_tokens: 1200,
    });

    const scoreValue = Number(review?.score);
    const safeScore = Number.isFinite(scoreValue)
      ? Math.min(10, Math.max(1, Math.round(scoreValue * 10) / 10))
      : 6.5;

    const toArray = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : []);
    const rewritten = Array.isArray(review?.rewritten_points)
      ? review.rewritten_points
          .map((item) => ({
            before: String(item?.before || '').trim(),
            after: String(item?.after || '').trim(),
            why: String(item?.why || '').trim(),
          }))
          .filter((item) => item.after)
      : [];

    return {
      score: safeScore,
      summary: String(review?.summary || '').trim(),
      strengths: toArray(review?.strengths),
      weaknesses: toArray(review?.weaknesses),
      improvements: toArray(review?.improvements),
      rewritten_points: rewritten.slice(0, 3),
    };
  }

  async rewriteResumePoints(resumeText) {
    const result = await this.callJson(PROMPTS.rewriteResumePoints(resumeText), {
      temperature: 0.45,
      max_tokens: 900,
    });

    const items = Array.isArray(result)
      ? result
      : Array.isArray(result?.items)
        ? result.items
        : [];

    return items
      .map((item) => ({
        original: String(item?.original || '').trim(),
        improved: String(item?.improved || '').trim(),
      }))
      .filter((item) => item.original && item.improved)
      .slice(0, 5);
  }

  rewriteResumePointsFallback(resumeText) {
    const candidates = extractResumeBullets(resumeText);
    const rewrites = candidates
      .map((original) => ({
        original,
        improved: rewriteBulletHeuristically(original) || makeGenericRewrite(original),
      }))
      .filter((item) => item.original && item.improved)
      .slice(0, 5);

    if (rewrites.length > 0) return rewrites;

    const fallbackSeed = String(resumeText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);

    if (!fallbackSeed) return [];

    return [
      {
        original: fallbackSeed,
        improved: `Reframed this experience to highlight measurable impact, clearer ownership, and stronger role relevance.`,
      },
    ];
  }

  async rewriteBullet(bullet, jobContext) {
    return this.callJson(PROMPTS.rewriteBullet(bullet, jobContext), {
      temperature: 0.5,
      max_tokens: 400,
    });
  }

  async suggestKeywords(jobText, currentSkills) {
    return this.callJson(PROMPTS.suggestKeywords(jobText, currentSkills), {
      temperature: 0.2,
      max_tokens: 500,
    });
  }

  async generateInsights(resumeText, jobText, analysis) {
    return this.callJson(PROMPTS.combinedInsights(resumeText, jobText, analysis), {
      temperature: 0.35,
      max_tokens: 700,
    });
  }

  async coachChat(payload) {
    const result = await this.callJson(PROMPTS.coachChat(payload), {
      temperature: 0.5,
      max_tokens: 900,
    });

    return {
      reply: String(result?.reply || '').trim(),
      suggestedFollowUps: Array.isArray(result?.suggestedFollowUps)
        ? result.suggestedFollowUps
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 3)
        : [],
    };
  }

  async startInterview(payload) {
    const result = await this.callJson(PROMPTS.interviewStart(payload), {
      temperature: 0.55,
      max_tokens: 650,
    });

    return {
      coachIntro: String(result?.coachIntro || '').trim(),
      question: String(result?.question || '').trim(),
      focusArea: String(result?.focusArea || 'General').trim(),
    };
  }

  async continueInterview(payload) {
    const result = await this.callJson(PROMPTS.interviewTurn(payload), {
      temperature: 0.45,
      max_tokens: 900,
    });

    const rawScore = Number(result?.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(1, Math.min(10, Math.round(rawScore)))
      : 6;

    return {
      feedback: String(result?.feedback || '').trim(),
      score,
      idealAnswerTip: String(result?.idealAnswerTip || '').trim(),
      nextQuestion: String(result?.nextQuestion || '').trim(),
      isComplete: Boolean(result?.isComplete),
    };
  }
}

module.exports = new OpenAIService();