const Groq = require("groq-sdk");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function staleMinsToLabel(mins) {
  if (mins <   2) return "just now";
  if (mins <  60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h ago`;
}

function parseJsonResponse(text, fallback) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try { return JSON.parse(cleaned) }
  catch { return fallback }
}

// ─── Local fallback scorer ────────────────────────────────────────────────────
// Mirrors the computeRisk logic in marketplace/page.tsx exactly.
// Both must stay in sync — if you change one, change the other.
function getLocalRiskScore(machine) {
  const now       = Math.floor(Date.now() / 1000);
  const staleMins = Math.max(0, Math.floor((now - machine.lastHeartbeat) / 60));
  const ageHours  = Math.max(0, Math.floor((now - machine.registeredAt)  / 3600));
  const repScore  = machine.reputationScore ?? 500;
  const isOffline = staleMins > 360;

  // Attestation URI is contract-required since v2.
  // A missing URI means this is a legacy machine — hard block, skip scoring.
  if (!machine.attestationURI) {
    return {
      score: 0,
      tier: "HIGH",
      reasons: ["No attestation URI — legacy machine, cannot be leased"],
      eligible: false,
      isOffline,
      suggestedMaxEpochs: 0,
      mode: "local",
    };
  }

  let score = 50;
  const reasons = [];

  // Graduated heartbeat penalty — severity scales with how long the machine has been silent
  if      (staleMins > 1440) { score -= 70; reasons.push("Offline 24h+ — provider unreachable") }
  else if (staleMins >  720) { score -= 60; reasons.push("Offline 12h+ — likely unreachable") }
  else if (staleMins >  360) { score -= 50; reasons.push("Offline 6h+ — high risk") }
  else if (staleMins >  120) { score -= 35; reasons.push("Offline 2h+ — provider not responding") }
  else if (staleMins >   60) { score -= 25; reasons.push("Offline 1h+ — heartbeat stale") }
  else if (staleMins >   30) { score -= 15; reasons.push("Heartbeat older than 30 min") }
  else if (staleMins >    5) { score -=  5; reasons.push("Heartbeat slightly stale") }
  else if (staleMins >    2) { score +=  5; reasons.push("Heartbeat fresh") }
  else                       { score += 10; reasons.push("Heartbeat very fresh — active machine") }

  // Provider age
  if (ageHours  <   24) { score -= 10; reasons.push("Registered < 24h ago") }
  else if (ageHours > 168) { score += 10; reasons.push("7+ days on platform") }

  // Reputation
  if      (repScore < 400) { score -= 25; reasons.push("Reputation below 400") }
  else if (repScore > 700) { score += 15; reasons.push("Reputation above 700") }

  score = Math.max(0, Math.min(100, score));
  const tier     = score >= 80 ? "LOW" : score >= 50 ? "MEDIUM" : "HIGH";
  const eligible = score >= 50 && !isOffline;

  return {
    score,
    tier,
    reasons: reasons.slice(0, 3),
    eligible,
    isOffline,
    suggestedMaxEpochs: score >= 80 ? 50 : score >= 50 ? 10 : 0,
    mode: "local",
  };
}

// ─── Groq response normaliser ─────────────────────────────────────────────────
function normalizeGroqRiskResult(parsed, localResult, staleMins) {
  const score = parsed && Number(parsed.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return {
      ...localResult,
      reasons: ["Groq returned invalid score — local scoring used", ...localResult.reasons].slice(0, 3),
      mode: "local-fallback",
    };
  }

  const isOffline = staleMins > 360;
  const tier      = score >= 80 ? "LOW" : score >= 50 ? "MEDIUM" : "HIGH";
  const reasons   = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter(r => typeof r === "string").slice(0, 3)
    : localResult.reasons;
  const eligible  = score >= 50 && !isOffline;

  return {
    ...localResult,
    score,
    tier,
    reasons,
    eligible,
    isOffline,
    suggestedMaxEpochs: parsed.suggestedMaxEpochs ?? (score >= 80 ? 50 : score >= 50 ? 10 : 0),
    mode: "groq",
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function scoreMachineRisk(machine) {
  const localResult = getLocalRiskScore(machine);

  // Already hard-blocked (no attestation) — don't waste a Groq call
  if (!machine.attestationURI) return localResult;

  if (!process.env.GROQ_API_KEY) return localResult;

  const now       = Math.floor(Date.now() / 1000);
  const staleMins = Math.max(0, Math.floor((now - machine.lastHeartbeat) / 60));
  const ageHours  = Math.max(0, Math.floor((now - machine.registeredAt)  / 3600));
  const repScore  = machine.reputationScore ?? 500;

  const prompt = `You are a compute marketplace risk engine on BOT Chain.
Score this provider machine for lease eligibility. Score 0-100, eligible if score >= 50 AND offline = false.

MACHINE:
- Hardware: ${machine.hardwareClass} | Region: ${machine.region}
- Heartbeat: ${staleMinsToLabel(staleMins)} (${staleMins} minutes ago)
- Provider age: ${ageHours}h on platform
- Reputation: ${repScore}/1000
- Attestation URI: PROVIDED (contract-enforced, not a scoring factor)

SCORING RULES (apply these exactly — no other factors):
Heartbeat staleness (graduated — this is the most important signal):
  > 1440 min (24h): -70 (unreachable)
  > 720 min (12h):  -60 (likely unreachable)
  > 360 min (6h):   -50 (offline — also sets isOffline=true, forces eligible=false)
  > 120 min (2h):   -35
  > 60 min (1h):    -25
  > 30 min:         -15
  > 5 min:          -5
  <= 2 min:         +10 (very fresh — machine is actively heartbeating)
  2-10 min:         +5  (fresh)

Provider age:
  < 24h:  -10
  > 7d:   +10

Reputation:
  < 400:  -25
  > 700:  +15

Start from base score 50. Apply penalties/bonuses. Clamp to [0, 100].
eligible = (score >= 50) AND (staleMins <= 360)
suggestedMaxEpochs = score >= 80 ? 50 : score >= 50 ? 10 : 0

Respond ONLY with raw JSON — no markdown, no explanation:
{"score": <0-100>, "tier": "LOW"|"MEDIUM"|"HIGH", "reasons": ["<up to 3 short strings>"], "eligible": true|false, "suggestedMaxEpochs": <int>}`;

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const response = await groq.chat.completions.create({
      model:       "llama3-70b-8192",
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  250,
      temperature: 0.1,
    });
    const text   = response.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseJsonResponse(text, null);
    return normalizeGroqRiskResult(parsed, localResult, staleMins);
  } catch (e) {
    return {
      ...localResult,
      reasons: [`Groq unavailable (${e.message.slice(0,40)}) — local scoring used`, ...localResult.reasons].slice(0, 3),
      mode: "local-fallback",
    };
  }
}

module.exports = { scoreMachineRisk, getLocalRiskScore, normalizeGroqRiskResult };