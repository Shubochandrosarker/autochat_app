import { NextResponse } from "next/server";

const BILLING_API_BASE = (
  process.env.BILLING_API_BASE ??
  "https://adhdtoolsdaily.com/wp-json/adhd/v1"
).replace(/\/$/, "");
const BILLING_API_BEARER = process.env.BILLING_API_BEARER?.trim();

export type BillingResponse = {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error?: string;
};

function getBillingError(data: Record<string, unknown>, status: number) {
  const nested = data.data;
  if (nested && typeof nested === "object" && "message" in nested) {
    const message = (nested as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  for (const value of [data.message, data.error]) {
    if (typeof value === "string" && value) return value;
  }

  return `Billing service returned HTTP ${status}.`;
}

export async function billingRequest({
  endpoint,
  payload,
}: {
  endpoint: string;
  payload: Record<string, unknown>;
}): Promise<BillingResponse> {
  if (!BILLING_API_BEARER) {
    return {
      ok: false,
      status: 500,
      data: {},
      error: "Billing is not configured.",
    };
  }

  try {
    const response = await fetch(`${BILLING_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BILLING_API_BEARER}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const responseText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      const parsed = responseText ? JSON.parse(responseText) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Keep provider response details out of the client when WordPress does
      // not return JSON.
    }

    const hasApplicationError = data.success === false || Boolean(data.error);
    return {
      ok: response.ok && !hasApplicationError,
      status: response.status || 502,
      data,
      ...(response.ok && !hasApplicationError
        ? {}
        : { error: getBillingError(data, response.status || 502) }),
    };
  } catch {
    return {
      ok: false,
      status: 502,
      data: {},
      error: "Could not reach the billing service.",
    };
  }
}

export async function forwardBillingRequest({
  endpoint,
  payload,
}: {
  endpoint: string;
  payload: Record<string, unknown>;
}) {
  const result = await billingRequest({ endpoint, payload });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? "Billing request failed." },
      { status: result.status },
    );
  }

  return NextResponse.json(result.data, { status: result.status });
}
