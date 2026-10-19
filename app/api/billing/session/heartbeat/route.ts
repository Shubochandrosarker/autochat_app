import { NextResponse } from "next/server";

import { forwardBillingRequest } from "../../utils";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const sessionId =
      typeof body?.session_id === "string" ? body.session_id.trim() : "";
    if (!token || !sessionId) {
      return NextResponse.json(
        { success: false, error: "Missing token or billing session." },
        { status: 400 },
      );
    }
    return await forwardBillingRequest({
      endpoint: "/session_heartbeat",
      payload: { token, session_id: sessionId },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid heartbeat request." },
      { status: 400 },
    );
  }
}
