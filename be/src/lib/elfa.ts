import { fetchWithTimeout } from "./fetchWithTimeout";

const BASE_URL = "https://api.elfa.ai";

function getHeaders() {
  const apiKey = process.env.ELFA_API_KEY;
  if (!apiKey || apiKey === "your_elfa_api_key_here") {
    throw new Error("ELFA_API_KEY not set");
  }
  return {
    "x-elfa-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

export async function getTrendingTokens(timeWindow: string = "24h") {
  const res = await fetchWithTimeout(`${BASE_URL}/v2/aggregations/trending-tokens?timeWindow=${timeWindow}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Elfa trending-tokens failed: ${res.status}`);
  return res.json();
}

export async function getTopMentions(ticker: string) {
  // Elfa returns empty data when timeWindow/pageSize/page are omitted — the
  // endpoint silently short-circuits to {total:0} instead of erroring. Pass
  // the required defaults so the validator and sentiment-proxy see real rows.
  const qs = `ticker=${encodeURIComponent(ticker)}&timeWindow=24h&pageSize=10&page=1`;
  const res = await fetchWithTimeout(`${BASE_URL}/v2/data/top-mentions?${qs}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Elfa top-mentions failed: ${res.status}`);
  return res.json();
}

export async function getKeywordMentions(keywords: string[]) {
  const q = keywords.slice(0, 5).join(",");
  const res = await fetchWithTimeout(`${BASE_URL}/v2/data/keyword-mentions?keywords=${encodeURIComponent(q)}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Elfa keyword-mentions failed: ${res.status}`);
  return res.json();
}

export async function getTrendingNarratives() {
  const res = await fetchWithTimeout(`${BASE_URL}/v2/data/trending-narratives`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Elfa trending-narratives failed: ${res.status}`);
  return res.json();
}

export async function chatAnalysis(
  message: string,
  mode: "tokenAnalysis" | "macro" | "summary" | "chat" | "tokenIntro" | "accountAnalysis" = "tokenAnalysis",
  ticker?: string
) {
  // Elfa API expects `message` (not `query`). The earlier name caused 400s.
  const body: Record<string, string> = { message, mode };
  if (ticker) body.ticker = ticker;

  const res = await fetchWithTimeout(`${BASE_URL}/v2/chat`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Elfa chat failed: ${res.status}`);
  return res.json();
}
