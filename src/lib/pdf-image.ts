/**
 * Turn a remote image (e.g. a Clerk organization logo) into something the
 * hand-written PDF in `timesheet-export.ts` can embed as an image XObject.
 *
 * Dependency-free and isomorphic (browser + Node): JPEGs are embedded as-is
 * via /DCTDecode; PNGs are decoded, flattened onto white, downscaled and
 * re-compressed via /FlateDecode using the built-in (De)CompressionStream.
 * Anything else (SVG, WebP, interlaced or 16-bit PNGs...) yields `null` so the
 * PDF simply renders without a logo.
 */

export type PdfImage = {
  width: number;
  height: number;
  colorSpace: "DeviceRGB" | "DeviceGray";
  filter: "DCTDecode" | "FlateDecode";
  /** Encoded image bytes, ready to drop into a PDF stream. */
  data: Uint8Array;
};

/** Larger PNGs are downscaled so the logo doesn't bloat the PDF. */
export const MAX_IMAGE_SIZE = 256;

/* ----------------------------------------------------------------- JPEG -- */

// Start-of-frame markers (baseline, extended, progressive, lossless...).
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function parseJpeg(bytes: Uint8Array): PdfImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] as number;
    const length = view.getUint16(offset + 2);
    if (SOF_MARKERS.has(marker)) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      const components = bytes[offset + 9];
      // CMYK JPEGs need Adobe-specific inversion handling; not worth it here.
      if (components !== 1 && components !== 3) return null;
      if (!width || !height) return null;
      return {
        width,
        height,
        colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
        filter: "DCTDecode",
        data: bytes,
      };
    }
    offset += 2 + length;
  }
  return null;
}

/* ------------------------------------------------------------------ PNG -- */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Channels per pixel for each PNG colour type (8-bit depth only).
const PNG_CHANNELS: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // RGB
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // RGBA
};

async function transform(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  }).pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** Reverse PNG scanline filters in place; returns raw pixel bytes. */
export function unfilterPng(
  raw: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array | null {
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x] as number;
      const left = x >= bpp ? (out[dst + x - bpp] as number) : 0;
      const up = y > 0 ? (out[dst - stride + x] as number) : 0;
      const upLeft =
        y > 0 && x >= bpp ? (out[dst - stride + x - bpp] as number) : 0;
      let decoded: number;
      switch (filter) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = value + left;
          break;
        case 2:
          decoded = value + up;
          break;
        case 3:
          decoded = value + ((left + up) >> 1);
          break;
        case 4:
          decoded = value + paeth(left, up, upLeft);
          break;
        default:
          return null;
      }
      out[dst + x] = decoded & 0xff;
    }
  }
  return out;
}

export async function parsePng(bytes: Uint8Array): Promise<PdfImage | null> {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const bitDepth = body[8];
      colorType = body[9] as number;
      const interlace = body[12];
      if (bitDepth !== 8 || interlace !== 0) return null;
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      paletteAlpha = body;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length; // length + type + body + CRC
  }

  const channels = PNG_CHANNELS[colorType];
  if (!channels || !width || !height || idat.length === 0) return null;
  if (colorType === 3 && !palette) return null;

  const compressed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let position = 0;
  for (const chunk of idat) {
    compressed.set(chunk, position);
    position += chunk.length;
  }

  let inflated: Uint8Array;
  try {
    inflated = await transform(compressed, new DecompressionStream("deflate"));
  } catch {
    return null;
  }
  const pixels = unfilterPng(inflated, width, height, channels);
  if (!pixels) return null;

  // Nearest-neighbour downscale + flatten onto a white background.
  const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const rgb = new Uint8Array(outWidth * outHeight * 3);

  for (let y = 0; y < outHeight; y++) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < outWidth; x++) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const i = (srcY * width + srcX) * channels;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (colorType === 3) {
        const index = pixels[i] as number;
        const p = palette as Uint8Array;
        r = p[index * 3] ?? 0;
        g = p[index * 3 + 1] ?? 0;
        b = p[index * 3 + 2] ?? 0;
        a = paletteAlpha?.[index] ?? 255;
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = pixels[i] as number;
        if (colorType === 4) a = pixels[i + 1] as number;
      } else {
        r = pixels[i] as number;
        g = pixels[i + 1] as number;
        b = pixels[i + 2] as number;
        if (colorType === 6) a = pixels[i + 3] as number;
      }
      const o = (y * outWidth + x) * 3;
      rgb[o] = Math.round((r * a + 255 * (255 - a)) / 255);
      rgb[o + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
      rgb[o + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
    }
  }

  return {
    width: outWidth,
    height: outHeight,
    colorSpace: "DeviceRGB",
    filter: "FlateDecode",
    data: await transform(rgb, new CompressionStream("deflate")),
  };
}

/* ---------------------------------------------------------------- fetch -- */

export async function decodePdfImage(
  bytes: Uint8Array,
): Promise<PdfImage | null> {
  return parseJpeg(bytes) ?? (await parsePng(bytes));
}

/**
 * Download an image and prepare it for the PDF. Never throws: any network,
 * timeout or decoding problem returns `null` so exports still succeed.
 */
export async function loadPdfImage(
  url: string | null | undefined,
  timeoutMs = 5000,
): Promise<PdfImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      // Ask image CDNs for formats we can embed rather than WebP/AVIF.
      headers: { Accept: "image/png,image/jpeg;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await decodePdfImage(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
