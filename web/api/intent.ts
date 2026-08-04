/**
 * /api/intent - the LLM seat of the intent engine.
 *
 * POST { message, lastIntent? } → { symbol, strategyId, params, understood, reply }
 *
 * Runs on Vercel Edge. Calls the Anthropic API with a forced tool call so the
 * model can ONLY answer in the app's structured-intent contract - the same
 * shape lib/intent.ts produces, so the frontend falls back to the offline
 * parser if this endpoint is unconfigured (no ANTHROPIC_API_KEY) or down.
 *
 * Design rule: the model interprets intent; it never does the math. Strikes,
 * premiums, payoffs and the honesty check are computed in code from its
 * structured output.
 *
 * Setup: add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment
 * Variables (optionally ANTHROPIC_MODEL, default claude-haiku-4-5).
 */
import { ASSETS, DEMO_PORTFOLIO, STRATEGIES } from "../src/data/appdata";

export const config = { runtime: "edge" };

const MODEL_DEFAULT = "claude-haiku-4-5";
const MAX_MESSAGE_LEN = 600;

/* per-instance best-effort rate limit: 10 req/min/IP */
const hits = new Map<string, { n: number; t: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5_000) hits.clear();
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  h.n += 1;
  return h.n > 10;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function buildSystem(): string {
  const held = (sym: string) => DEMO_PORTFOLIO.find((h) => h.symbol === sym)?.qty ?? 0;
  const assets = ASSETS.map(
    (a) =>
      `- ${a.symbol} (${a.name}): spot $${a.spot.toLocaleString()}, IV ${(a.iv * 100).toFixed(0)}%, ` +
      `${a.live ? "live on Derive" : "awaiting Derive listing (preview only)"}, user holds ${held(a.symbol)}`
  ).join("\n");
  const strategies = STRATEGIES.map(
    (s) => `- id "${s.id}" — ${s.name} (${s.proName}). ${s.tagline} Fits when: ${s.fitsWhen}`
  ).join("\n");

  return `You are the intent engine for Overwrite, an agentic options protocol for beginners. The user types what they want in plain English; you translate it into ONE structured trade via the structure_trade tool. Application code - not you - computes strikes, premiums, payoff diagrams and risk disclosures from your output.

ASSETS (demo portfolio):
${assets}

STRATEGIES:
${strategies}

RULES
- Always call structure_trade exactly once, even for vague or off-topic messages (pick the closest sensible structure and use "reply" to say why / answer briefly).
- symbol: the asset the user names; otherwise their largest holding.
- strategyId: the single best fit. Earning yield/income on a held asset → income. Getting paid while waiting to buy lower → wheel. Protection with upside kept → shield. Protection paid for by a cap / "costs nothing" → collar. Betting on a fall with capped risk → bear. Yield with NO directional exposure / "don't care which way it goes" / market-neutral → neutral.
- targetYieldAnnual: decimal (10% → 0.1), only if the user expresses an income/yield goal.
- capTarget: a PRICE of the underlying. For income/collar it is the "happy to sell above / give up upside past" level; for shield it is the desired floor. Only include if plausible (between 0.3x and 4x spot). Never invent one.
- stopLossPct: decimal, from "close/bail/exit if down X%".
- dte: days to expiry if the user implies a horizon (weekly → 7, monthly → 30). Clamp 3-120. Omit if unsaid.
- FOLLOW-UPS: when a lastIntent JSON is provided, the new message adjusts it. Return the FULL updated intent (e.g. "hit my yield target" → same asset/strategy/yield/stop but drop capTarget; "make the cap 130k" → update capTarget only).
- understood: 2-5 short traces of what you parsed, e.g. "Income target: 10%/yr", "Auto-close if down 20%".
- reply: 1-2 warm plain-English sentences. No options jargon unless the user used it. NEVER state strikes, premiums, yields or any number you'd have to compute - the app adds the real numbers. Never promise profit or downplay risk. Do not repeat the "understood" list.`;
}

const TOOL = {
  name: "structure_trade",
  description: "Return the structured trade parsed from the user's message.",
  input_schema: {
    type: "object",
    properties: {
      symbol: { type: "string", enum: ASSETS.map((a) => a.symbol) },
      strategyId: { type: "string", enum: STRATEGIES.map((s) => s.id) },
      targetYieldAnnual: { type: ["number", "null"], description: "decimal, e.g. 0.1 for 10%/yr" },
      capTarget: { type: ["number", "null"], description: "price of the underlying, USD" },
      stopLossPct: { type: ["number", "null"], description: "decimal, e.g. 0.2 for 20%" },
      dte: { type: ["integer", "null"], description: "days to expiry, 3-120" },
      understood: { type: "array", items: { type: "string" }, description: "2-5 short parse traces" },
      reply: { type: "string", description: "1-2 sentence plain-English response" },
    },
    required: ["symbol", "strategyId", "understood", "reply"],
  },
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = (globalThis as any).process?.env?.ANTHROPIC_API_KEY as string | undefined;
  if (!key) return json({ error: "not_configured" }, 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return json({ error: "rate_limited" }, 429);

  let message = "", lastIntent: unknown = null;
  try {
    const body = await req.json();
    message = String(body?.message ?? "").slice(0, MAX_MESSAGE_LEN).trim();
    lastIntent = body?.lastIntent ?? null;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!message) return json({ error: "empty_message" }, 400);

  const userContent =
    lastIntent != null
      ? `Previous intent (adjust from this if the message is a follow-up):\n${JSON.stringify(lastIntent).slice(0, 800)}\n\nUser message: ${message}`
      : `User message: ${message}`;

  const model =
    ((globalThis as any).process?.env?.ANTHROPIC_MODEL as string | undefined) || MODEL_DEFAULT;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system: buildSystem(),
      tools: [TOOL],
      tool_choice: { type: "tool", name: "structure_trade" },
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!r.ok) {
    // never leak upstream error bodies (may reference the key/account)
    return json({ error: "upstream_error", status: r.status }, 502);
  }

  const data = await r.json();
  const call = (data?.content ?? []).find((b: any) => b?.type === "tool_use");
  const input = call?.input;
  if (!input || typeof input !== "object") return json({ error: "no_tool_call" }, 502);

  /* ---- validate & clamp: never trust model output blindly ---- */
  const asset = ASSETS.find((a) => a.symbol === input.symbol);
  const strat = STRATEGIES.find((s) => s.id === input.strategyId);
  if (!asset || !strat) return json({ error: "invalid_intent" }, 502);

  const num = (v: unknown): number | null =>
    typeof v === "number" && isFinite(v) ? v : null;

  const y = num(input.targetYieldAnnual);
  const cap = num(input.capTarget);
  const stop = num(input.stopLossPct);
  const dte = num(input.dte);

  const params: Record<string, number> = {};
  if (y != null && y > 0.004 && y <= 1.5) params.targetYieldAnnual = y;
  if (cap != null && cap > asset.spot * 0.3 && cap < asset.spot * 4) params.capTarget = cap;
  if (stop != null && stop >= 0.01 && stop <= 0.9) params.stopLossPct = stop;
  if (dte != null && dte >= 3 && dte <= 120) params.dte = Math.round(dte);

  const understood = Array.isArray(input.understood)
    ? input.understood.filter((x: unknown) => typeof x === "string").slice(0, 6)
    : [];
  const reply = typeof input.reply === "string" ? input.reply.slice(0, 600) : undefined;

  return json({ symbol: asset.symbol, strategyId: strat.id, params, understood, reply });
}
