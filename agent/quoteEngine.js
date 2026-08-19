const Groq = require("groq-sdk");

const MARKET_RATES_PER_HOUR = {
  "GPU-H100": 2.5,
  "GPU-A100": 1.8,
  "GPU-RTX4090": 0.8,
  "GPU-RTX3090": 0.45,
  "CPU-64": 0.3,
};

function getLocalQuote(req) {
  const marketHourlyRate = MARKET_RATES_PER_HOUR[req.hardwareClass] ?? 0.3;
  const hoursPerEpoch = Math.max(0, req.epochDuration) / 3600;
  const centralisedPerEpochBOT = (marketHourlyRate * hoursPerEpoch) / 0.1;
  const riskMultiplier =
    req.riskScore >= 80 ? 0.85 : req.riskScore >= 50 ? 0.75 : 0;
  const pricePerEpochBOT = centralisedPerEpochBOT * riskMultiplier;
  const totalPriceBOT = pricePerEpochBOT * req.totalEpochs;
  const discount = Math.round((1 - riskMultiplier) * 100);

  return {
    pricePerEpochBOT: pricePerEpochBOT.toFixed(6),
    totalPriceBOT: totalPriceBOT.toFixed(6),
    rationale: `Priced from the ${req.hardwareClass} market rate with a ${discount}% marketplace discount.`,
    discount: `${discount}%`,
    mode: "local",
  };
}

function toWei(botAmount) {
  const [whole = "0", fraction = ""] = String(botAmount).split(".");
  return BigInt(whole || "0") * 10n ** 18n +
    BigInt((fraction + "0".repeat(18)).slice(0, 18));
}

function withWeiValues(quote, totalEpochs) {
  const pricePerEpochWei = toWei(quote.pricePerEpochBOT);
  return {
    ...quote,
    pricePerEpochWei: pricePerEpochWei.toString(),
    totalPriceWei: (pricePerEpochWei * BigInt(totalEpochs)).toString(),
    validUntilSeconds: Math.floor(Date.now() / 1000) + 300,
  };
}

function isValidDecimal(value) {
  return (
    typeof value === "string" &&
    /^\d+(?:\.\d{1,18})?$/.test(value.trim()) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}

function normalizeGroqQuote(parsed, localQuote, req) {
  const price = typeof parsed?.pricePerEpochBOT === "string"
    ? parsed.pricePerEpochBOT.trim()
    : "";
  const localPrice = Number(localQuote.pricePerEpochBOT);
  const maxMultiplier = Number(process.env.MAX_GROQ_PRICE_MULTIPLIER || "2");
  const maxPrice = localPrice * (
    Number.isFinite(maxMultiplier) && maxMultiplier > 0 ? maxMultiplier : 2
  );

  const totalPrice = typeof parsed?.totalPriceBOT === "string"
    ? parsed.totalPriceBOT.trim()
    : "";
  const priceWei = isValidDecimal(price) ? toWei(price) : null;
  const expectedTotalWei = priceWei === null
    ? null
    : priceWei * BigInt(req.totalEpochs);
  const totalMatches =
    isValidDecimal(totalPrice) && toWei(totalPrice) === expectedTotalWei;

  if (
    !isValidDecimal(price) ||
    !Number.isFinite(localPrice) ||
    Number(price) > maxPrice ||
    !totalMatches
  ) {
    return {
      ...withWeiValues(localQuote, req.totalEpochs),
      mode: "local-fallback",
      quoteWarning: "Groq returned an invalid or unsafe price; local pricing used",
    };
  }

  const pricePerEpochWei = priceWei;
  const totalPriceWei = expectedTotalWei;
  const totalPriceBOT = (Number(price) * Number(req.totalEpochs)).toFixed(6);

  return {
    ...localQuote,
    pricePerEpochBOT: price,
    totalPriceBOT,
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : localQuote.rationale,
    discount:
      typeof parsed.discount === "string" || typeof parsed.discount === "number"
        ? String(parsed.discount)
        : localQuote.discount,
    pricePerEpochWei: pricePerEpochWei.toString(),
    totalPriceWei: totalPriceWei.toString(),
    validUntilSeconds: Math.floor(Date.now() / 1000) + 300,
    mode: "groq",
  };
}

function parseJsonResponse(text, fallback) {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

async function generateQuote(req) {
  const localQuote = getLocalQuote(req);

  if (!process.env.GROQ_API_KEY) {
    return withWeiValues(localQuote, req.totalEpochs);
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const prompt = `You are a compute marketplace pricing engine for BOT Chain.
Generate a fair lease price for this compute job.

Request:
- Hardware: ${req.hardwareClass}
- Region: ${req.region}
- Epoch duration: ${req.epochDuration} seconds
- Total epochs: ${req.totalEpochs}
- Provider risk score: ${req.riskScore}/100

Market reference rates per hour:
- H100 GPU: $2.50
- A100 GPU: $1.80
- RTX 4090: $0.80
- RTX 3090: $0.45
- CPU 64-core: $0.30
- Treat 1 BOT = $0.10 for calculation

Return ONLY raw JSON, no markdown:
{
  "pricePerEpochBOT": "<decimal string>",
  "totalPriceBOT": "<decimal string>",
  "rationale": "<one sentence explaining the price>",
  "discount": "<percentage discount vs centralised>"
}`;

  try {
    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.1,
    });
    const text = response.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseJsonResponse(text, null);
    return normalizeGroqQuote(parsed, localQuote, req);
  } catch {
    return {
      ...withWeiValues(localQuote, req.totalEpochs),
      mode: "local-fallback",
    };
  }
}

module.exports = {
  generateQuote,
  getLocalQuote,
  normalizeGroqQuote,
  isValidDecimal,
  toWei,
};