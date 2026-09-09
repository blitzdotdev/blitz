export function bytesToHex(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string | ArrayBuffer | ArrayBufferView): Promise<string> {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(await crypto.subtle.digest("SHA-256", source));
}

export function randomBase64Url(bytes = 32): string {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of random) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBytes = /^[0-9a-f]{64}$/.test(left) ? hexToBytes(left) : new Uint8Array(32);
  const rightBytes = /^[0-9a-f]{64}$/.test(right) ? hexToBytes(right) : new Uint8Array(32);
  return crypto.subtle.timingSafeEqual(leftBytes, rightBytes) && left.length === right.length;
}

export async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  return timingSafeHexEqual(leftHash, rightHash);
}
