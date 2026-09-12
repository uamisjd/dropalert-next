/** Capacità di gestione custodita solo dal browser dopo la conferma push. */
export const PUSH_OWNER_KEY = "dropalert.push-owner.v1";
export function readPushToken(endpoint: string): string | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(PUSH_OWNER_KEY) ?? "null");
    return value?.endpoint === endpoint && typeof value.token === "string" && /^[a-f0-9]{64}$/.test(value.token) ? value.token : null;
  } catch { return null; }
}
export function savePushToken(endpoint: string, token: string): void {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("autorizzazione non valida");
  window.localStorage.setItem(PUSH_OWNER_KEY, JSON.stringify({ endpoint, token }));
}
export function clearPushToken(): void { window.localStorage.removeItem(PUSH_OWNER_KEY); }
export function pushHeaders(endpoint: string): Record<string, string> {
  const token = readPushToken(endpoint);
  return { "content-type": "application/json", ...(token ? { "x-push-token": token } : {}) };
}
export function verificationFromHash(hash: string): { id: string; code: string } | null {
  const match = /^#push-verify=([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(hash);
  return match ? { id: match[1], code: match[2] } : null;
}
