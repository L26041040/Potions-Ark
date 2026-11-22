import { describe, expect, it } from "vitest";
import { sniffImage } from "./image";

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(32).fill(0)]);

describe("sniffImage", () => {
  it("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    const webp = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
    expect(sniffImage(new Uint8Array([...webp, ...new Array(16).fill(0)]))).toBe("webp");
  });

  it("rejects anything else, whatever the file claims to be", () => {
    expect(sniffImage(new TextEncoder().encode("<html><body>not an image</body></html>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a........"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
