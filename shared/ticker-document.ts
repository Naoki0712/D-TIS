import type { TickerSegment } from "./display-settings";

export type TextSelection = { start: number; end: number };
export type TickerEdit = TextSelection & { inputType: string };
export const tickerText = (segments: TickerSegment[]) => segments.map(segment => segment.text).join("");
const id = () => crypto.randomUUID();

function slice(segments: TickerSegment[], start: number, end: number): TickerSegment[] {
  let offset = 0;
  return segments.flatMap(segment => {
    const from = Math.max(0, start - offset), to = Math.min(segment.text.length, end - offset);
    offset += segment.text.length;
    return to > from ? [{ ...segment, id: id(), text: segment.text.slice(from, to),
      pauseSeconds: to === segment.text.length ? segment.pauseSeconds : undefined }] : [];
  });
}

export function compactSegments(segments: TickerSegment[]): TickerSegment[] {
  const result: TickerSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const previous = result.at(-1);
    if (previous && !previous.pauseSeconds && previous.color === segment.color && previous.font === segment.font
      && previous.weight === segment.weight && previous.blink === segment.blink) {
      previous.text += segment.text; previous.pauseSeconds = segment.pauseSeconds;
    } else result.push({ ...segment });
  }
  return result.length ? result : [{ id: id(), text: "" }];
}

/** Replace only the edited range so that typing retains the surrounding character styles. */
export function replaceTickerRange(segments: TickerSegment[], selection: TextSelection, text: string): TickerSegment[] {
  let offset = 0;
  const style = segments.find(segment => { offset += segment.text.length; return offset >= selection.start; });
  return compactSegments([...slice(segments, 0, selection.start),
    ...(text ? [{ ...style, id: id(), text, pauseSeconds: undefined }] : []),
    ...slice(segments, selection.end, Infinity)]);
}

export function editTickerText(segments: TickerSegment[], text: string, edit?: TickerEdit): TickerSegment[] {
  const previous = tickerText(segments);
  // A text diff alone cannot locate edits among repeated, differently styled characters.
  if (edit) {
    let { start, end } = edit;
    if (start === end && text.length < previous.length) {
      const removed = previous.length - text.length;
      if (/Backward$/.test(edit.inputType)) start = Math.max(0, start - removed);
      else if (/Forward$/.test(edit.inputType)) end = Math.min(previous.length, end + removed);
    }
    const prefix = previous.slice(0, start), suffix = previous.slice(end);
    const insertedLength = text.length - prefix.length - suffix.length;
    if (insertedLength >= 0 && text.startsWith(prefix) && text.endsWith(suffix)) {
      return replaceTickerRange(segments, { start, end }, text.slice(start, start + insertedLength));
    }
  }
  let start = 0, before = previous.length, after = text.length;
  while (start < before && start < after && previous[start] === text[start]) start++;
  while (before > start && after > start && previous[before - 1] === text[after - 1]) { before--; after--; }
  return replaceTickerRange(segments, { start, end: before }, text.slice(start, after));
}

export function styleTickerRange(segments: TickerSegment[], selection: TextSelection, style: Partial<TickerSegment>): TickerSegment[] {
  return compactSegments([...slice(segments, 0, selection.start),
    ...slice(segments, selection.start, selection.end).map(segment => ({ ...segment, ...style, id: id() })),
    ...slice(segments, selection.end, Infinity)]);
}
