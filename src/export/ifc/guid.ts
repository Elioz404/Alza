/**
 * IFC GlobalIds: 128-bit identifiers written in IFC's own 22-character base-64 form
 * (IfcGloballyUniqueId; buildingSMART, "IFC GUID" compression).
 *
 * Every GlobalId the export writes is derived from a key built from the plan's own ids
 * ("wall:wall_n", "opening:door_main"), so exporting the same plan twice gives every element
 * the same GlobalId, and a CAD tool that re-imports the file updates its elements instead of
 * duplicating them. The 128 bits are a hash of the key, marked as an RFC 9562 version 8
 * (application-defined) UUID.
 */

/** IFC's base-64 alphabet, in order of value. */
export const IFC_GUID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
/** A compressed GlobalId: 22 characters of the alphabet, the first one 0–3 (it holds two bits). */
export const IFC_GUID = /^[0-3][0-9A-Za-z_$]{21}$/;

/**
 * 128 bits from a string: four 32-bit lanes of MurmurHash3-style mixing over its UTF-16 code
 * units, each lane seeded differently, then cross-mixed so every output bit depends on every
 * input unit. Not cryptographic — it only has to spread distinct keys apart.
 */
export function hash128(key: string): Uint8Array {
  let h1 = 0x6a09e667;
  let h2 = 0xbb67ae85;
  let h3 = 0x3c6ef372;
  let h4 = 0xa54ff53a;
  for (let i = 0; i < key.length; i++) {
    const k = key.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  [h1, h2, h3, h4].forEach((h, i) => view.setUint32(i * 4, h >>> 0));
  return bytes;
}

/** 16 bytes as an IFC compressed GUID: the first byte in two characters, then five groups of three bytes in four each. */
export function compressGuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("A GUID is 16 bytes.");
  const b64 = (value: number, chars: number): string => {
    let out = "";
    for (let i = chars - 1; i >= 0; i--) out += IFC_GUID_ALPHABET[Math.floor(value / 64 ** i) % 64];
    return out;
  };
  let out = b64(bytes[0], 2);
  for (let i = 1; i < 16; i += 3) out += b64((bytes[i] << 16) + (bytes[i + 1] << 8) + bytes[i + 2], 4);
  return out;
}

/** The GlobalId for `key`: its hash as a version 8, RFC 9562 variant UUID, compressed. */
export function ifcGuid(key: string): string {
  const bytes = hash128(key);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return compressGuid(bytes);
}

/**
 * Hands out one GlobalId per key, and refuses a key twice: two elements built from the same
 * key would share a GlobalId, which IFC forbids, so a mapping that tried is a bug to surface.
 */
export class GuidRegistry {
  private readonly keys = new Set<string>();
  private readonly guids = new Set<string>();

  take(key: string): string {
    if (this.keys.has(key)) throw new Error(`GlobalId key "${key}" was used twice.`);
    const guid = ifcGuid(key);
    if (this.guids.has(guid)) throw new Error(`GlobalId ${guid} collided for "${key}".`);
    this.keys.add(key);
    this.guids.add(guid);
    return guid;
  }
}
