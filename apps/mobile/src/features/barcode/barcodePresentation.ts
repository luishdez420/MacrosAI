export type BarcodeLookupStatus =
  | "idle"
  | "scanning"
  | "looking_up"
  | "matched"
  | "no_match"
  | "error";

export type LastBarcodeScan = {
  barcode: string;
  scannedAt: number;
};

export const duplicateScanCooldownMs = 3500;

export function normalizeBarcode(value: string) {
  return value.replace(/\D/g, "");
}

export function shouldIgnoreBarcodeScan({
  barcode,
  scannerPaused,
  lookupPending,
  lastScan,
  now,
}: {
  barcode: string;
  scannerPaused: boolean;
  lookupPending: boolean;
  lastScan: LastBarcodeScan;
  now: number;
}) {
  if (!barcode || scannerPaused || lookupPending) {
    return true;
  }

  return lastScan.barcode === barcode && now - lastScan.scannedAt < duplicateScanCooldownMs;
}

export function barcodeNoMatchMessage(barcode: string) {
  return `No reliable packaged-food record was found for ${barcode}. Try another angle, type the number, or search manually.`;
}

export function captionForStatus(status: BarcodeLookupStatus, isPending: boolean) {
  if (isPending || status === "looking_up") {
    return "Looking up barcode...";
  }

  if (status === "matched") {
    return "Matched. Confirm the portion below.";
  }

  if (status === "no_match" || status === "error") {
    return "Scanner paused. Choose an action below.";
  }

  if (status === "scanning") {
    return "Scanner ready. Align the barcode inside the frame.";
  }

  return "Align the barcode inside the frame";
}
