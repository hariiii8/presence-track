/** Constant-time string comparison for device credentials (pure JS, safe on any runtime). */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Returns an error Response when the request is not from an enrolled ESP32-CAM node. */
export function rejectUnlessDevice(
  request: Request,
  expected: string | undefined,
): Response | null {
  if (!expected) {
    return Response.json(
      { success: false, error: "Device ingestion is not configured on this server" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-device-key") ?? "";
  if (!provided || !constantTimeEqual(provided, expected)) {
    return Response.json({ success: false, error: "Unauthorized device" }, { status: 401 });
  }
  return null;
}
