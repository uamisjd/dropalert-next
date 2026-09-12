/** Legge JSON con limite sui byte effettivi, anche senza Content-Length.
 * Non si carica un corpo illimitato per poi controllarne la dimensione.
 */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<
  { ok: true; data: unknown } | { ok: false; response: Response }
> {
  const reject = (status: number, reason: string) => ({
    ok: false as const,
    response: Response.json({ ok: false, reason }, { status, headers: { "Cache-Control": "no-store" } }),
  });
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return reject(415, "usare Content-Type application/json");
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") return reject(415, "corpo compresso non supportato");
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return reject(413, "richiesta troppo grande");
  }
  if (!request.body) return reject(400, "corpo non leggibile");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return reject(413, "richiesta troppo grande");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return reject(400, "corpo non leggibile");
  } finally {
    reader.releaseLock();
  }
}
