import {
  barcodeNoMatchMessage,
  captionForStatus,
  duplicateScanCooldownMs,
  normalizeBarcode,
  shouldIgnoreBarcodeScan,
} from "../barcodePresentation";

describe("barcode presentation helpers", () => {
  it("normalizes typed and scanned barcode values", () => {
    expect(normalizeBarcode(" 0 12345-67890 5 ")).toBe("012345678905");
    expect(normalizeBarcode("UPC: abc")).toBe("");
  });

  it("pauses repeated scans of the same barcode during cooldown", () => {
    expect(
      shouldIgnoreBarcodeScan({
        barcode: "012345678905",
        scannerPaused: false,
        lookupPending: false,
        lastScan: { barcode: "012345678905", scannedAt: 1000 },
        now: 1000 + duplicateScanCooldownMs - 1,
      })
    ).toBe(true);

    expect(
      shouldIgnoreBarcodeScan({
        barcode: "012345678905",
        scannerPaused: false,
        lookupPending: false,
        lastScan: { barcode: "012345678905", scannedAt: 1000 },
        now: 1000 + duplicateScanCooldownMs + 1,
      })
    ).toBe(false);
  });

  it("ignores scans while paused, pending, or empty", () => {
    const lastScan = { barcode: "", scannedAt: 0 };

    expect(
      shouldIgnoreBarcodeScan({
        barcode: "012345678905",
        scannerPaused: true,
        lookupPending: false,
        lastScan,
        now: 1000,
      })
    ).toBe(true);
    expect(
      shouldIgnoreBarcodeScan({
        barcode: "012345678905",
        scannerPaused: false,
        lookupPending: true,
        lastScan,
        now: 1000,
      })
    ).toBe(true);
    expect(
      shouldIgnoreBarcodeScan({
        barcode: "",
        scannerPaused: false,
        lookupPending: false,
        lastScan,
        now: 1000,
      })
    ).toBe(true);
  });

  it("uses inline no-match copy and paused scanner captions", () => {
    expect(barcodeNoMatchMessage("012345678905")).toContain("No reliable packaged-food record");
    expect(captionForStatus("no_match", false)).toBe("Scanner paused. Choose an action below.");
    expect(captionForStatus("error", false)).toBe("Scanner paused. Choose an action below.");
    expect(captionForStatus("looking_up", false)).toBe("Looking up barcode...");
    expect(captionForStatus("idle", false)).toBe("Align the barcode inside the frame");
  });
});
