// @vitest-environment node
import { deflateSync, inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodePdfImage,
  loadPdfImage,
  MAX_IMAGE_SIZE,
  parseJpeg,
  parsePng,
  unfilterPng,
} from "@/lib/pdf-image";

/* ---------------------------------------------------------- fixtures -- */

const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

// CRCs aren't checked by the decoder, so zeros keep the fixtures simple.
const chunk = (type: string, body: number[] | Uint8Array) => [
  ...u32(body.length),
  ...[...type].map((c) => c.charCodeAt(0)),
  ...body,
  0,
  0,
  0,
  0,
];

const ihdr = (
  width: number,
  height: number,
  colorType: number,
  { bitDepth = 8, interlace = 0 } = {},
) =>
  chunk("IHDR", [
    ...u32(width),
    ...u32(height),
    bitDepth,
    colorType,
    0,
    0,
    interlace,
  ]);

const png = (...chunks: number[][]) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunks.flat(),
  ]);

/** Scanlines are `[filter, ...bytes]` rows. */
const idat = (rows: number[][]) =>
  chunk("IDAT", deflateSync(Uint8Array.from(rows.flat())));

const iend = () => chunk("IEND", []);

const pixelsOf = (image: { data: Uint8Array }) => [...inflateSync(image.data)];

const jpeg = (sof: number, components: number, width = 3, height = 2) =>
  Uint8Array.from([
    0xff,
    0xd8,
    // APP0 segment that must be skipped.
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    // Start of frame.
    0xff,
    sof,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
    0x00,
    0x00,
    0x00,
  ]);

/* ------------------------------------------------------------- tests -- */

describe("parseJpeg", () => {
  it("reads dimensions and colour space from the frame header", () => {
    const rgb = jpeg(0xc0, 3);
    expect(parseJpeg(rgb)).toEqual({
      width: 3,
      height: 2,
      colorSpace: "DeviceRGB",
      filter: "DCTDecode",
      data: rgb,
    });
    // Progressive grayscale.
    expect(parseJpeg(jpeg(0xc2, 1))).toMatchObject({
      colorSpace: "DeviceGray",
    });
  });

  it("rejects non-JPEGs, CMYK, empty frames and broken markers", () => {
    expect(parseJpeg(Uint8Array.from([0x89, 0x50]))).toBeNull();
    expect(parseJpeg(jpeg(0xc0, 4))).toBeNull();
    expect(parseJpeg(jpeg(0xc0, 3, 0, 2))).toBeNull();
    expect(parseJpeg(jpeg(0xc0, 3, 3, 0))).toBeNull();
    const broken = jpeg(0xc0, 3);
    broken[8] = 0x00; // Segment no longer starts with 0xFF.
    expect(parseJpeg(broken)).toBeNull();
    // Runs out of data before finding a frame header.
    expect(parseJpeg(jpeg(0xc0, 3).subarray(0, 14))).toBeNull();
  });
});

describe("unfilterPng", () => {
  it("reverses all five PNG filter types", () => {
    // 2x5 grayscale, one row per filter type.
    const raw = Uint8Array.from([
      ...[0, 10, 20],
      ...[1, 5, 5], // sub: left + value
      ...[2, 1, 1], // up
      ...[3, 2, 2], // average
      ...[4, 1, 1], // paeth (returns b for col0, a for col1)
    ]);
    expect([...(unfilterPng(raw, 2, 5, 1) as Uint8Array)]).toEqual([
      10, 20, 5, 10, 6, 11, 5, 10, 6, 11,
    ]);
    // Exercise Paeth branch where c (up-left) is closest to p = a + b - c:
    // row0=[100, 200], row1 col0 -> 0, row1 col1: a=0, b=200, c=100 -> p=100 -> c wins (pa <= pb && pa > pc)
    // Also exercise pa > pb && pb <= pc: row0=[0, 10], row1=[100, +1] -> col1: a=100, b=10, c=0 -> p=110 -> pa=10, pb=100, pc=110 -> a wins!
    expect([
      ...(unfilterPng(
        Uint8Array.from([0, 0, 10, 4, 100, 1]),
        2,
        2,
        1,
      ) as Uint8Array),
    ]).toEqual([0, 10, 100, 101]);
    expect([
      ...(unfilterPng(
        Uint8Array.from([0, 100, 200, 4, 156, 5]),
        2,
        2,
        1,
      ) as Uint8Array),
    ]).toEqual([100, 200, 0, 105]);
  });

  it("rejects unknown filters and truncated data", () => {
    expect(unfilterPng(Uint8Array.from([5, 0]), 1, 1, 1)).toBeNull();
    expect(unfilterPng(Uint8Array.from([0]), 1, 1, 1)).toBeNull();
  });
});

describe("parsePng", () => {
  it("decodes RGB and flattens RGBA onto white", async () => {
    const rgb = await parsePng(
      png(ihdr(1, 1, 2), chunk("tEXt", [0x41]), idat([[0, 1, 2, 3]]), iend()),
    );
    expect(rgb).toMatchObject({
      width: 1,
      height: 1,
      colorSpace: "DeviceRGB",
      filter: "FlateDecode",
    });
    expect(pixelsOf(rgb as never)).toEqual([1, 2, 3]);

    const rgba = await parsePng(
      png(ihdr(2, 1, 6), idat([[0, 0, 0, 0, 0, 0, 0, 0, 255]])),
    );
    // Fully transparent pixel -> white, opaque black stays black.
    expect(pixelsOf(rgba as never)).toEqual([255, 255, 255, 0, 0, 0]);
  });

  it("decodes grayscale and grayscale + alpha", async () => {
    const gray = await parsePng(png(ihdr(1, 1, 0), idat([[0, 100]]), iend()));
    expect(pixelsOf(gray as never)).toEqual([100, 100, 100]);

    const grayAlpha = await parsePng(
      png(ihdr(1, 1, 4), idat([[0, 0, 0]]), iend()),
    );
    expect(pixelsOf(grayAlpha as never)).toEqual([255, 255, 255]);
  });

  it("decodes palettes with and without transparency", async () => {
    const plte = chunk("PLTE", [255, 0, 0, 0, 0, 255]);
    const withAlpha = await parsePng(
      png(
        ihdr(4, 1, 3),
        plte,
        chunk("tRNS", [0]),
        // Index 0 is transparent, 1 is opaque blue, 2 is past the palette.
        idat([[0, 0, 1, 2, 1]]),
        iend(),
      ),
    );
    expect(pixelsOf(withAlpha as never)).toEqual([
      255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255,
    ]);

    const opaque = await parsePng(
      png(ihdr(1, 1, 3), plte, idat([[0, 0]]), iend()),
    );
    expect(pixelsOf(opaque as never)).toEqual([255, 0, 0]);
  });

  it("downscales large images", async () => {
    const width = MAX_IMAGE_SIZE * 2;
    const image = await parsePng(
      png(ihdr(width, 1, 0), idat([[0, ...new Array(width).fill(7)]]), iend()),
    );
    expect(image).toMatchObject({ width: MAX_IMAGE_SIZE, height: 1 });
  });

  it("returns null for anything it can't embed", async () => {
    const body = idat([[0, 1, 2, 3]]);
    const cases = [
      Uint8Array.from([1, 2, 3]),
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]),
      png(ihdr(1, 1, 2, { bitDepth: 16 }), body),
      png(ihdr(1, 1, 2, { interlace: 1 }), body),
      png(ihdr(1, 1, 5), body), // invalid colour type
      png(ihdr(0, 1, 2), body),
      png(ihdr(1, 0, 2), body),
      png(ihdr(1, 1, 2)), // no image data
      png(ihdr(1, 1, 3), idat([[0, 0]])), // palette image without PLTE
      png(ihdr(1, 1, 2), chunk("IDAT", [1, 2, 3])), // corrupt deflate data
      png(ihdr(1, 1, 2), idat([[9, 1, 2, 3]])), // bad filter type
      png(body), // no IHDR at all
    ];
    for (const bytes of cases) {
      expect(await parsePng(bytes)).toBeNull();
    }
  });
});

describe("decodePdfImage", () => {
  it("detects JPEG and PNG and rejects other formats", async () => {
    expect(await decodePdfImage(jpeg(0xc0, 3))).toMatchObject({
      filter: "DCTDecode",
    });
    expect(
      await decodePdfImage(png(ihdr(1, 1, 0), idat([[0, 1]]), iend())),
    ).toMatchObject({ filter: "FlateDecode" });
    expect(
      await decodePdfImage(new TextEncoder().encode("<svg></svg>")),
    ).toBeNull();
  });
});

describe("loadPdfImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and decodes the image", async () => {
    const fetchMock = vi.fn(
      async () => new Response(jpeg(0xc0, 3), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadPdfImage("https://img.clerk.com/logo")).toMatchObject({
      width: 3,
      height: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://img.clerk.com/logo",
      expect.objectContaining({
        headers: { Accept: "image/png,image/jpeg;q=0.9" },
      }),
    );
  });

  it("returns null without a URL, on HTTP errors and on network failures", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadPdfImage(undefined)).toBeNull();
    expect(await loadPdfImage(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect(await loadPdfImage("https://x/logo")).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await loadPdfImage("https://x/logo")).toBeNull();
  });
});
