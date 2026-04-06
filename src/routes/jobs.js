const express = require('express');
const router = express.Router();
const jobMatcher = require('../services/jobMatcher');

function normalizeSkills(skills) {
	if (!Array.isArray(skills)) return [];

	return skills
		.map((skill) => String(skill || '').trim())
		.filter(Boolean)
		.filter((skill, index, arr) => arr.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index);
}

router.post('/match', (req, res) => {
	try {
		const skills = normalizeSkills(req.body?.skills);

		if (!skills.length) {
			return res.status(400).json({ error: 'skills array is required.' });
		}

		const matchResult = jobMatcher.match({ skills, resumeText: '' });

		const jobs = (matchResult.results || []).map((job) => ({
			title: job.title,
			company: job.company,
			location: job.location,
			score: job.matchScore,
			link: job.applyUrl,
		}));

		return res.json({
			jobs,
			summary: matchResult.summary,
			topMissingSkills: matchResult.topMissingSkills,
		});
	} catch (err) {
		return res.status(500).json({ error: err.message || 'Failed to match jobs.' });
	}
});

module.exports = router;
