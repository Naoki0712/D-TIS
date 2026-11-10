import test from "node:test";
import assert from "node:assert/strict";
import { trainTypeColor, trainTypeColors } from "../src/train-types";

const hanzomon = "odpt.Railway:TokyoMetro.Hanzomon";
const tozai = "odpt.Railway:TokyoMetro.Tozai";
const asakusa = "odpt.Railway:Toei.Asakusa";

test("specified local, semi express, rapid, commuter express and express colors", () => {
  for (const [type, color] of [
    ["各駅停車", trainTypeColors.local],
    ["準急", trainTypeColors.semiExpress],
    ["快速", trainTypeColors.rapid],
    ["通勤急行", trainTypeColors.commuterExpress],
    ["急行", trainTypeColors.express],
  ]) assert.equal(trainTypeColor(type, hanzomon), color, type);
});

test("Tozai rapid is red while rapid on other lines is light blue", () => {
  assert.equal(trainTypeColor("快速", tozai), trainTypeColors.express);
  assert.equal(trainTypeColor("快速", "odpt.Railway:MIR.TsukubaExpress"), trainTypeColors.rapid);
  assert.equal(trainTypeColor("通勤快速", tozai), trainTypeColors.express);
  assert.equal(trainTypeColor("区間快速", "odpt.Railway:MIR.TsukubaExpress"), trainTypeColors.rapid);
});

test("express variants keep their own precedence and limited express variants are red", () => {
  assert.equal(trainTypeColor("通勤急行", hanzomon), trainTypeColors.commuterExpress);
  assert.equal(trainTypeColor("通勤準急", hanzomon), trainTypeColors.semiExpress);
  for (const type of ["快速急行", "特急", "アクセス特急", "快特", "エアポート快特", "通勤特急"]) {
    assert.equal(trainTypeColor(type, asakusa), trainTypeColors.express, type);
    assert.equal(trainTypeColor(type, "odpt.Railway:Keikyu.Main"), trainTypeColors.express, type);
  }
});

test("ODPT identifiers and English aliases follow the same rules", () => {
  assert.equal(trainTypeColor("odpt.TrainType:Tokyu.CommuterExpress", hanzomon), trainTypeColors.commuterExpress);
  assert.equal(trainTypeColor("Semi Express", hanzomon), trainTypeColors.semiExpress);
  assert.equal(trainTypeColor("Rapid", tozai), trainTypeColors.express);
  assert.equal(trainTypeColor("Rapid", hanzomon), trainTypeColors.rapid);
  assert.equal(trainTypeColor("Rapid Express", hanzomon), trainTypeColors.express);
  assert.equal(trainTypeColor("AirportRapidLimitedExpress", asakusa), trainTypeColors.express);
  assert.equal(trainTypeColor("AirportRapid", asakusa), trainTypeColors.express);
});
