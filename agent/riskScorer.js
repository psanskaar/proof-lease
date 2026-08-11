const Groq = require("groq-sdk");

const DEFAULT_SCORE = {
  score: 50,
  tier: "MEDIUM",
  reasons: ["Local fallback scoring is active"],
  eligible: true,
  suggestedMaxEpochs: 10,
};

function getLocalRiskScore(machine) {
  let score = 50;
  const reasons = [];
  const now = Math.floor(Date.now() / 1000);
  const staleMins = Math.max(0, Math.floor((now - machine.lastHeartbeat) / 60));
  const ageHours = Math.max(0, Math.floor((now - machine.registeredAt) / 3600));
  const reputationScore = machine.reputationScore ?? 500;

  if (staleMins > 30) {
    score -= 20;
    reasons.push("Heartbeat is older than 30 minutes");
  } else {
    reasons.push("Heartbeat is fresh");
  }

  if (!machine.attestationURI) {
    score -= 15;
    reasons.push("No attestation URI provided");
  } else {
    score += 5;
  }

  if (ageHours < 24) {
    score -= 10;
    reasons.push("Provider has been registered for less than 24 hours");
  } else if (ageHours > 24 * 7) {
    score += 10;
    reasons.push("Provider has more than seven days of history");
  }

  if (reputationScore < 400) {
    score -= 25;
    reasons.push("Provider reputation is below 400");
  } else if (reputationScore > 700) {
    score += 15;
    reasons.push("Provider reputation is above 700");
  }

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 80 ? "LOW" : score >= 50 ? "MEDIUM" : "HIGH";

  return {
    score,
    tier,
    reasons: reasons.slice(0, 3),
    eligible: score >= 50,
    suggestedMaxEpochs: score >= 80 ? 50 : score >= 50 ? 10 : 0,
  };
}

function parseJsonResponse(text, fallback) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

function normalizeGroqRiskResult(parsed, localResult) {
  const score = parsed && Number(parsed.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return {
      ...localResult,
      reasons: [
        "Groq returned an invalid score; local scoring used",
        ...localResult.reasons,
      ].slice(0, 3),
      mode: "local-fallback",
    };
  }

  const tier = score >= 80 ? "LOW" : score >= 50 ? "MEDIUM" : "HIGH";
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter((reason) => typeof reason === "string").slice(0, 3)
    : [];

  return {
    ...localResult,
    score,
    tier,
    reasons: reasons.length ? reasons : localResult.reasons,
    eligible: score >= 50,
    suggestedMaxEpochs: score >= 80 ? 50 : score >= 50 ? 10 : 0,
    mode: "groq",
  };
}

async function scoreMachineRisk(machine) {
  const localResult = getLocalRiskScore(machine);

  if (!process.env.GROQ_API_KEY) {
    return {
      ...localResult,
      mode: "local",
    };
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const staleMins = Math.max(
    0,
    Math.floor((Date.now() / 1000 - machine.lastHeartbeat) / 60),
  );
  const ageHours = Math.max(
    0,
    Math.floor((Date.now() / 1000 - machine.registeredAt) / 3600),
  );

  const prompt = `You are a compute marketplace risk engine on BOT Chain.
Evaluate this machine for lease eligibility.

Machine details:
- Hardware class: ${machine.hardwareClass}
- Region: ${machine.region}
- Last heartbeat: ${staleMins} minutes ago
- Provider age: ${ageHours} hours on platform
- Attestation: ${machine.attestationURI || "NONE PROVIDED"}
- Provider reputation score: ${machine.reputationScore ?? 500}/1000

Return ONLY raw JSON, no markdown, no explanation, no code fences:
{
  "score": <integer 0-100>,
  "tier": <"LOW" or "MEDIUM" or "HIGH">,
  "reasons": [<up to 3 short strings>],
  "eligible": <true or false>,
  "suggestedMaxEpochs": <integer>
}

Scoring rules:
- 80-100 = LOW risk, eligible = true
- 50-79 = MEDIUM risk, eligible = true
- 0-49 = HIGH risk, eligible = false
- Deduct 20 if heartbeat older than 30 minutes
- Deduct 15 if no attestation URI
- Deduct 10 if provider registered less than 24 hours ago
- Deduct 25 if reputation score below 400
- Add 15 if reputation score above 700
- Add 10 if provider registered over 7 days ago`;

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
      temperature: 0.1,
    });
    const text = response.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseJsonResponse(text, null);
    return normalizeGroqRiskResult(parsed, localResult);
  } catch {
    return {
      ...localResult,
      reasons: ["Groq unavailable; local scoring used", ...localResult.reasons].slice(
        0,
        3,
      ),
      mode: "local-fallback",
    };
  }
}

module.exports = {
  scoreMachineRisk,
  getLocalRiskScore,
  normalizeGroqRiskResult,
  DEFAULT_SCORE,
};
