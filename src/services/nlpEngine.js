const natural = require('natural');
const TfIdf = natural.TfIdf;

class NLPEngine {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.stopWords = new Set([
      'the','and','for','with','that','this','have','from',
      'are','was','were','been','has','had','not','but','they'
    ]);
  }

  tokenize(text) {
    if (!text || typeof text !== 'string') return [];

    return this.tokenizer
      .tokenize(text.toLowerCase())
      .map((w) => w.replace(/[^a-z0-9+#.-]/g, ''))
      .filter((w) => w.length > 2 && !this.stopWords.has(w));
  }

  extractKeywords(text, topN = 30) {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!normalizedText) return [];

    const tfidf = new TfIdf();
    tfidf.addDocument(normalizedText);
    const terms = [];
    tfidf.listTerms(0).slice(0, topN).forEach(item => {
      terms.push({ term: item.term, score: item.tfidf });
    });
    return terms;
  }

  cosineSimilarity(vecA, vecB) {
    const allTerms = [...new Set([...Object.keys(vecA), ...Object.keys(vecB)])];
    let dot = 0, magA = 0, magB = 0;
    for (const term of allTerms) {
      const a = vecA[term] || 0;
      const b = vecB[term] || 0;
      dot += a * b;
      magA += a * a;
      magB += b * b;
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  buildTFIDFVector(text) {
    const tokens = this.tokenize(text);
    if (!tokens.length) return {};

    const freq = {};
    tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    const maxFreq = Math.max(...Object.values(freq));
    Object.keys(freq).forEach(t => { freq[t] = freq[t] / maxFreq; });
    return freq;
  }

  analyze(resumeText, jobText) {
    const normalizedResume = typeof resumeText === 'string' ? resumeText : '';
    const normalizedJob = typeof jobText === 'string' ? jobText : '';

    if (!normalizedResume.trim()) {
      throw new Error('Resume text is empty and cannot be analyzed.');
    }
    if (!normalizedJob.trim()) {
      throw new Error('Job description is empty. Add a job description to calculate ATS score.');
    }

    const resumeVec = this.buildTFIDFVector(resumeText);
    const jobVec = this.buildTFIDFVector(jobText);
    const similarity = this.cosineSimilarity(resumeVec, jobVec);

    const jobKeywords = [...new Set(this.extractKeywords(jobText, 40).map(k => k.term))];
    const resumeKeywords = new Set(this.tokenize(resumeText));

    if (!jobKeywords.length) {
      return {
        atsScore: Math.round(similarity * 100),
        matchPercentage: Math.round(similarity * 100),
        keywordMatchScore: 0,
        matchedKeywords: [],
        missingKeywords: [],
        resumeKeywordCount: resumeKeywords.size,
        jobKeywordCount: 0,
        summary: 'Could not extract enough keywords from the job description. Try a more detailed posting.',
      };
    }

    const matched = jobKeywords.filter(k => resumeKeywords.has(k));
    const missing = jobKeywords.filter(k => !resumeKeywords.has(k));

    const keywordMatchScore = (matched.length / jobKeywords.length) * 100;
    const atsScore = Math.round(
      (similarity * 0.5 + (keywordMatchScore / 100) * 0.5) * 100
    );

    return {
      atsScore: Math.min(atsScore, 100),
      matchPercentage: Math.round(similarity * 100),
      keywordMatchScore: Math.round(keywordMatchScore),
      matchedKeywords: matched,
      missingKeywords: missing.slice(0, 15),
      resumeKeywordCount: resumeKeywords.size,
      jobKeywordCount: jobKeywords.length,
      summary:
        atsScore >= 80
          ? 'Strong alignment with the job description.'
          : atsScore >= 60
          ? 'Moderate alignment. Add more job-specific keywords and measurable achievements.'
          : 'Low alignment. Tailor the resume with role-specific keywords and experience.',
    };
  }
}

module.exports = new NLPEngine();