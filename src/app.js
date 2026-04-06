const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const analyzeRoute = require("./routes/analyze");
const rewriteRoute = require("./routes/rewrite");
const jobsRoute = require("./routes/jobs");
const coachRoute = require("./routes/coach");
const { apiLimiter, rewriteLimiter, jobsLimiter } = require("./middleware/rateLimiter");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Backend running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ai-resume-analyser-api", port: PORT });
});

app.use("/api/analyze", apiLimiter, analyzeRoute);
app.use("/upload", apiLimiter, analyzeRoute);
app.use("/api/rewrite", rewriteLimiter, rewriteRoute);
app.use("/rewrite", rewriteLimiter, rewriteRoute);
app.use("/api/jobs", jobsLimiter, jobsRoute);
app.use("/api/coach", apiLimiter, coachRoute);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the old process or run with PORT=<new_port>.`);
    process.exit(1);
  }

  console.error("Failed to start server:", err?.message || err);
  process.exit(1);
});