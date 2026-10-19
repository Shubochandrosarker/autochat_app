/**
 * Mint a LiveAvatar session token only after the WordPress purchase token is
 * verified, then open the server-side billing session ledger.
 */
import { NextResponse } from "next/server";

import { billingRequest } from "../billing/utils";

const API_BASE = (
  process.env.LIVEAVATAR_API_BASE ?? "https://api.liveavatar.com"
).replace(/\/$/, "");
const DEFAULT_AVATARS = [
  "513fd1b7-7ef9-466d-9af2-344e51eeb833",
  "e9844e6d-847e-4964-a92b-7ecd066f69df",
];

type RequestBody = {
  avatarId?: string;
  contextId?: string;
  maxSessionDuration?: number;
  language?: string;
  token?: string;
  clientSessionId?: string;
};

function safeErrorMessage(data: Record<string, unknown>, fallback: string) {
  return typeof data.message === "string" && data.message
    ? data.message
    : fallback;
}

export async function POST(request: Request) {
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "LiveAvatar API key is not configured." },
      { status: 500 },
    );
  }

  let body: RequestBody = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const purchaseToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!purchaseToken) {
    return NextResponse.json(
      { error: "Purchase token missing. Please open this page from your purchase link." },
      { status: 401 },
    );
  }

  const entitlement = await billingRequest({
    endpoint: "/verify_token",
    payload: { token: purchaseToken },
  });
  if (
    !entitlement.ok ||
    entitlement.data.success !== true ||
    entitlement.data.valid !== true ||
    entitlement.data.expired === true
  ) {
    return NextResponse.json(
      {
        error:
          entitlement.error ??
          "Invalid purchase token. Please open the avatar from your purchase link.",
      },
      { status: entitlement.status === 500 ? 500 : 403 },
    );
  }

  const configuredAvatar = process.env.LIVEAVATAR_AVATAR_ID?.trim();
  const avatarId = (body.avatarId?.trim() || configuredAvatar || DEFAULT_AVATARS[0]);
  const allowedAvatarIds = new Set(
    [configuredAvatar, ...DEFAULT_AVATARS].filter(Boolean),
  );
  if (!allowedAvatarIds.has(avatarId)) {
    return NextResponse.json({ error: "Unsupported avatar selection." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    mode: "FULL",
    avatar_id: avatarId,
    max_session_duration:
      typeof body.maxSessionDuration === "number" &&
      body.maxSessionDuration > 0 &&
      body.maxSessionDuration <= 300
        ? Math.floor(body.maxSessionDuration)
        : 300,
  };
  if (body.contextId?.trim()) payload.context_id = body.contextId.trim();

  try {
    const avatarResponse = await fetch(`${API_BASE}/v1/avatars/${avatarId}`, {
      headers: { "X-API-KEY": apiKey },
      cache: "no-store",
    });
    const avatarRaw = await avatarResponse.text();
    let avatarData: {
      data?: { default_voice_agent_id?: string | null } | null;
    } = {};
    try {
      avatarData = JSON.parse(avatarRaw);
    } catch {
      avatarData = {};
    }

    if (!avatarResponse.ok) {
      return NextResponse.json(
        { error: "Could not load the selected LiveAvatar." },
        { status: 502 },
      );
    }

    const agentId = avatarData.data?.default_voice_agent_id;
    if (!agentId) {
      return NextResponse.json(
        { error: "The selected avatar has no default voice agent configured." },
        { status: 502 },
      );
    }
    payload.voice_agent = { id: agentId };

    const tokenResponse = await fetch(`${API_BASE}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const raw = await tokenResponse.text();
    let tokenData: {
      data?: { session_id?: string; session_token?: string };
      message?: string;
    } = {};
    try {
      tokenData = JSON.parse(raw);
    } catch {
      tokenData = {};
    }

    const providerSessionId = tokenData.data?.session_id?.trim();
    const providerSessionToken = tokenData.data?.session_token?.trim();
    if (!tokenResponse.ok || !providerSessionId || !providerSessionToken) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            tokenData as Record<string, unknown>,
            `LiveAvatar rejected the session request (HTTP ${tokenResponse.status}).`,
          ),
        },
        { status: 502 },
      );
    }

    const billingSession = await billingRequest({
      endpoint: "/session_start",
      payload: {
        token: purchaseToken,
        provider_session_id: providerSessionId,
        client_session_id:
          typeof body.clientSessionId === "string"
            ? body.clientSessionId.trim().slice(0, 64)
            : "",
      },
    });
    const billingSessionId = billingSession.data.session_id;
    if (
      !billingSession.ok ||
      typeof billingSessionId !== "string" ||
      !billingSessionId
    ) {
      return NextResponse.json(
        { error: billingSession.error ?? "Could not start the billing session." },
        { status: billingSession.status === 409 ? 409 : 502 },
      );
    }

    return new NextResponse(providerSessionToken, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
        "X-LiveAvatar-Session-Id": providerSessionId,
        "X-ADHD-Billing-Session-Id": billingSessionId,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to retrieve the LiveAvatar session token." },
      { status: 502 },
    );
  }
}
