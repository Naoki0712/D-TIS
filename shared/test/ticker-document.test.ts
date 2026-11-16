import test from "node:test";
import assert from "node:assert/strict";
import { editTickerText, replaceTickerRange, styleTickerRange, tickerText } from "../ticker-document";

test("typing and pasting preserve formatting outside the changed text", () => {
  const segments = [{ id: "a", text: "安全", color: "#ff3300", pauseSeconds: 2 }, { id: "b", text: "にお進みください" }];
  const edited = editTickerText(segments, "安全にゆっくりお進みください");
  assert.equal(tickerText(edited), "安全にゆっくりお進みください");
  assert.deepEqual(edited[0], { ...segments[0], id: edited[0].id });
  const pasted = replaceTickerRange(edited, { start: 2, end: 3 }, "、\n");
  assert.equal(tickerText(pasted), "安全、\nゆっくりお進みください");
  assert.equal(pasted[0].color, "#ff3300");
  assert.equal(pasted[0].pauseSeconds, 2);
});

test("formatting a selection preserves the other ranges and their pause points", () => {
  const segments = [{ id: "a", text: "ご案内です", color: "#ffffff", pauseSeconds: 3 }];
  const styled = styleTickerRange(segments, { start: 1, end: 3 }, { color: "#ffff00", weight: 700 });
  assert.equal(tickerText(styled), "ご案内です");
  assert.deepEqual(styled.map(({ text, color, pauseSeconds }) => ({ text, color, pauseSeconds })), [
    { text: "ご", color: "#ffffff", pauseSeconds: undefined },
    { text: "案内", color: "#ffff00", pauseSeconds: undefined },
    { text: "です", color: "#ffffff", pauseSeconds: 3 },
  ]);
  assert.equal(new Set(styled.map(s => s.id)).size, styled.length);
});

test("deleting repeated characters retains the actual surviving character's style", () => {
  const segments = [{ id: "a", text: "あ", color: "#ff0000" }, { id: "b", text: "あ", color: "#0000ff" }];
  for (const edit of [{ start: 0, end: 1, inputType: "deleteContentBackward" },
    { start: 1, end: 1, inputType: "deleteContentBackward" }, { start: 0, end: 0, inputType: "deleteContentForward" }]) {
    const next = editTickerText(segments, "あ", edit);
    assert.equal(tickerText(next), "あ"); assert.equal(next[0].color, "#0000ff");
  }
});
