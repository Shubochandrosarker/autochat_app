/**
 * LiveAvatar backend: mint session tokens via the official LiveAvatar API.
 *
 * POST /api/get-access-token
 * Body (optional): { avatarId?: string, contextId?: string, maxSessionDuration?: number }
 *
 * Env required:
 *   LIVEAVATAR_API_KEY  – API key from app.liveavatar.com/developers
 *   LIVEAVATAR_AVATAR_ID (optional fallback) – default avatar when none passed
 *
 * Returns the session token as plain text (legacy contract of this endpoint),
 * with X-LiveAvatar-Session-Id header carrying the session id.
 */
import { NextResponse } from "next/server";

const API_BASE = process.env.LIVEAVATAR_API_BASE ?? "https://api.liveavatar.com";

// Server-side billing enforcement (2026-10-10): a LiveAvatar session is only
// minted for a valid, non-expired purchase token. This is the authoritative
// gate — the client-side checks are convenience only.
const BILLING_API_BASE =
  process.env.BILLING_API_BASE ?? "https://adhdtoolsdaily.com/wp-json/adhd/v1";
const BILLING_API_BEARER = process.env.BILLING_API_BEARER ?? "";

async function enforceBillingEntitlement(
  token: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!BILLING_API_BEARER) {
    return { ok: false, status: 500, error: "Billing is not configured." };
  }
  try {
    const res = await fetch(`${BILLING_API_BASE}/verify_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BILLING_API_BEARER}`,
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    let data: {
      success?: boolean;
      valid?: boolean;
      expired?: boolean;
      message?: string;
      error?: string;
    } = {};
    try {
      data = JSON.parse(await res.text());
    } catch {
      data = {};
    }
    if (!res.ok || data?.success !== true || data?.valid !== true) {
      return {
        ok: false,
        status: 403,
        error:
          data?.message ||
          "Invalid purchase token. Please open the avatar from your purchase link.",
      };
    }
    if (data?.expired === true) {
      return {
        ok: false,
        status: 403,
        error:
          "Your session minutes are used up. Please purchase a new session to continue.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Could not validate your purchase. Please try again.",
    };
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.LIVEAVATAR_API_KEY;

  if (!apiKey) {
    console.error("[liveavatar] LIVEAVATAR_API_KEY missing");
    return NextResponse.json(
      { error: "LiveAvatar API key is not configured." },
      { status: 500 },
    );
  }

  let body: {
    avatarId?: string;
    contextId?: string;
    maxSessionDuration?: number;
    language?: string;
    token?: string;
  } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }

  const purchaseToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!purchaseToken) {
    return NextResponse.json(
      { error: "Purchase token missing. Please open this page from your purchase link." },
      { status: 401 },
    );
  }
  const billing = await enforceBillingEntitlement(purchaseToken);
  if (!billing.ok) {
    console.error("[liveavatar] billing gate blocked session mint:", billing.error);
    return NextResponse.json(
      { error: billing.error },
      { status: billing.status },
    );
  }

  const avatarId =
    body.avatarId ||
    (process.env.LIVEAVATAR_AVATAR_ID || undefined);

  if (!avatarId) {
    return NextResponse.json(
      { error: "avatarId is required (no LIVEAVATAR_AVATAR_ID fallback set)." },
      { status: 400 },
    );
  }

  const payload: Record<string, unknown> = {
    mode: "FULL",
    avatar_id: avatarId,
  };
  if (body.contextId) payload.context_id = body.contextId;
  // 30-minute cap requested, but LiveAvatar API caps max_session_duration at 300s per token.
  payload.max_session_duration =
    body.maxSessionDuration &&
    body.maxSessionDuration > 0 &&
    body.maxSessionDuration <= 300
      ? body.maxSessionDuration
      : 300;

  // FULL mode now REQUIRES exactly one of voice_agent | avatar_persona.
  // Use the avatar's default voice agent (set per-avatar in LiveAvatar dashboard).
  try {
    const avRes = await fetch(`${API_BASE}/v1/avatars/${avatarId}`, {
      headers: { "X-API-KEY": apiKey },
    });
    const avRaw = await avRes.text();
    let av: {
      data?: { default_voice_agent_id?: string | null } | null;
    } = {};
    try {
      av = JSON.parse(avRaw);
    } catch {
      av = {};
    }
    const agentId = av?.data?.default_voice_agent_id;
    if (!agentId) {
      console.error("[liveavatar] avatar has no default_voice_agent_id", avRes.status, avRaw.slice(0, 300));
      return NextResponse.json(
        {
          error:
            "Avatar has no default voice agent configured. Set one in the LiveAvatar dashboard for this avatar.",
        },
        { status: 502 },
      );
    }
    payload.voice_agent = { id: agentId };
  } catch (e) {
    console.error("[liveavatar] avatar lookup failed:", e);
    return NextResponse.json(
      { error: "Failed to look up avatar voice agent" },
      { status: 502 },
    );
  }

  try {
    const res = await fetch(`${API_BASE}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let parsed: {
      code?: number;
      data?: { session_id?: string; session_token?: string };
      message?: string;
    } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    if (!res.ok || !parsed?.data?.session_token) {
      console.error(
        "[liveavatar] session token failed",
        res.status,
        raw.slice(0, 500),
      );
      return NextResponse.json(
        {
          error:
            parsed?.message ||
            `LiveAvatar rejected the session request (HTTP ${res.status}).`,
        },
        { status: 502 },
      );
    }

    return new NextResponse(parsed.data.session_token, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "X-LiveAvatar-Session-Id": parsed.data.session_id ?? "",
      },
    });
  } catch (error) {
    console.error("[liveavatar] token fetch error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve LiveAvatar session token" },
      { status: 500 },
    );
  }
}
