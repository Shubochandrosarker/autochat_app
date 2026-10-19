/**
 * Compatibility client for older imports. Balances are read from the server;
 * there is intentionally no client-side set-minutes operation.
 */
const BILLING_API_BASE = process.env.NEXT_PUBLIC_BILLING_API_BASE || "/api/billing";

export interface VerifyTokenResponse {
  success: true;
  valid: boolean;
  expired?: boolean;
  remaining_seconds?: number;
  remaining_minutes?: number;
}

export interface MinutesRemainingResponse {
  success: true;
  active: boolean;
  expired: boolean;
  remaining_seconds: number;
  remaining_minutes: number;
}

export async function verifyToken(token: string): Promise<VerifyTokenResponse> {
  return request<VerifyTokenResponse>("/verify", { token });
}

export async function getMinutesRemaining(
  token: string,
): Promise<MinutesRemainingResponse> {
  return request<MinutesRemainingResponse>("/minutes", { token });
}

async function request<T>(endpoint: string, body: Record<string, unknown>) {
  const response = await fetch(`${BILLING_API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok || (data as { success?: boolean }).success !== true) {
    throw new Error(data.message || data.error || "Billing request failed.");
  }
  return data;
}
