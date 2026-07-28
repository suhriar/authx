(function attachAuthxTotp(global) {
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function normalizeSecret(secret) {
    return String(secret || "")
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, "");
  }

  function decodeBase32(secret) {
    const clean = normalizeSecret(secret);
    let bits = "";
    const bytes = [];

    for (const char of clean) {
      const value = BASE32_ALPHABET.indexOf(char);
      if (value === -1) {
        throw new Error("Invalid TOTP secret.");
      }
      bits += value.toString(2).padStart(5, "0");
      while (bits.length >= 8) {
        bytes.push(parseInt(bits.slice(0, 8), 2));
        bits = bits.slice(8);
      }
    }

    return new Uint8Array(bytes);
  }

  function counterToBytes(counter) {
    const bytes = new ArrayBuffer(8);
    const view = new DataView(bytes);
    const high = Math.floor(counter / 0x100000000);
    const low = counter >>> 0;
    view.setUint32(0, high);
    view.setUint32(4, low);
    return bytes;
  }

  async function generate(secret, timestamp = Date.now()) {
    const keyData = decodeBase32(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const counter = Math.floor(timestamp / 1000 / 30);
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterToBytes(counter)));
    const offset = signature[signature.length - 1] & 0x0f;
    const binary =
      ((signature[offset] & 0x7f) << 24) |
      ((signature[offset + 1] & 0xff) << 16) |
      ((signature[offset + 2] & 0xff) << 8) |
      (signature[offset + 3] & 0xff);

    return String(binary % 1000000).padStart(6, "0");
  }

  global.AuthXTotp = { generate };
})(globalThis);
