export async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error("Request too large"), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw Object.assign(new Error("Request too large"), { status: 413 });
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
