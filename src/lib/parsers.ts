/**
 * parseECG — accepts two formats:
 *   a) Single column of numbers, one sample per line
 *   b) Polar: skip header rows starting with "Time", "#", or "Sample",
 *      then extract the last numeric column per row
 *
 * Throws a descriptive Error when a non-numeric line is found after data starts.
 * Returns null when no samples were found at all.
 */
export function parseECG(text: string): number[] | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const values: number[] = [];
  let headerDone = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!headerDone && (line.startsWith('#') || /^time/i.test(line) || /^sample/i.test(line))) {
      continue;
    }

    const parts = line.split(/[,;\t]+/).map(p => p.trim());
    const candidate = parts[parts.length - 1];
    const num = parseFloat(candidate);

    if (!isNaN(num)) {
      headerDone = true;
      values.push(num);
    } else if (headerDone) {
      throw new Error(`Could not parse ECG — expected numeric values, found: ${line}`);
    }
    // Before first data row: skip unrecognised header lines silently
  }

  return values.length > 0 ? values : null;
}

export interface HRParseResult {
  values: number[];
  avg: number;
  max: number;
  /** Number of samples, assuming 1 sample/second */
  duration: number;
}

/**
 * parseHRFile — accepts two formats:
 *   a) Polar: header column "HR (bpm)"
 *   b) Garmin: header column "Heart Rate" or "heart_rate"
 *
 * Returns null when the column cannot be found or no valid values are parsed.
 */
export function parseHRFile(text: string): HRParseResult | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  const cols = lines[0].split(/[,;\t]+/).map(c => c.trim().toLowerCase());
  const hrColIdx = cols.findIndex(c =>
    c === 'hr (bpm)' || c === 'hr' || c === 'heart rate' || c === 'heart_rate',
  );
  if (hrColIdx === -1) return null;

  const values: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/[,;\t]+/).map(p => p.trim());
    const raw = parts[hrColIdx];
    if (!raw) continue;
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0) values.push(num);
  }

  if (values.length === 0) return null;

  const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  const max = Math.max(...values);

  return { values, avg, max, duration: values.length };
}
