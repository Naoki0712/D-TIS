import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stationAsset, railwayAsset, unknownAsset } from "../../shared/assets";

const assetsDirectory = fileURLToPath(new URL("../../assets/", import.meta.url));
const addedFolders = [
  "Joban_Line_Local", "Chuo-Sobu_Line_Local", "Toyo-Rapid_Line", "Saitama-Railway-Saitama-Stadium_Line",
  "Odawara_Line", "Enoshima_Line", "Tama_Line", "Keio_Line", "Keisei_Line", "Keikyu_Line", "Hokuso_Line",
];

test("every supplied new station-number image resolves to its exact shared asset path", () => {
  let checked = 0;
  for (const folder of addedFolders) {
    for (const file of readdirSync(path.join(assetsDirectory, folder))) {
      const match = /^([A-Za-z]+)-(\d{1,2}[A-Za-z]?)\.png$/.exec(file);
      if (!match) continue;
      assert.equal(stationAsset(`${match[1]}${match[2]}`), `/assets/${folder}/${file}`);
      checked++;
    }
  }
  assert.equal(checked, 415);
});

test("station code spelling, zero-number stations and Odawara variants retain the supplied filenames", () => {
  assert.equal(stationAsset(" jl-18 "), "/assets/Joban_Line_Local/JL-18.png");
  assert.equal(stationAsset("JB 1"), "/assets/Chuo-Sobu_Line_Local/JB-01.png");
  assert.equal(stationAsset("OE00"), "/assets/Enoshima_Line/OE-00.png");
  assert.equal(stationAsset("OT-00"), "/assets/Tama_Line/OT-00.png");
  assert.equal(stationAsset("KK0"), "/assets/Keikyu_Line/KK-00.png");
  assert.equal(stationAsset("OH47H"), "/assets/Odawara_Line/OH-47h.png");
  assert.equal(stationAsset("mb-03"), "/assets/Marunouchi_Line/Mb-03.png");
  for (const code of ["JL17", "SR18", "TR10", "KO54", "KK74", "OH47x", "KO999", "ST01"]) {
    assert.equal(stationAsset(code), unknownAsset, code);
  }
});

test("operator-qualified railway aliases preserve supplied line symbols and missing symbols stay safe", () => {
  const expected = new Map([
    ["odpt.Railway:ToyoRapid.ToyoRapid", "/assets/Toyo-Rapid_Line/TR.PNG"],
    ["odpt.Railway:Hokuso.Hokuso", "/assets/Hokuso_Line/HS.PNG"],
    ["odpt.Railway:Odakyu.Odawara", "/assets/Odawara_Line/OH.png"],
    ["odpt.Railway:Odakyu.Enoshima", "/assets/Enoshima_Line/OE.png"],
    ["odpt.Railway:Odakyu.Tama", "/assets/Tama_Line/OT.png"],
    ["odpt.Railway:Keisei.Main", "/assets/Keisei_Line/KS.png"],
  ]);
  for (const [railway, asset] of expected) {
    assert.equal(railwayAsset(railway), asset);
    const absolute = path.join(assetsDirectory, asset.slice("/assets/".length));
    assert.ok(readdirSync(path.dirname(absolute)).includes(path.basename(absolute)), "Filename case must match on Linux");
  }
  for (const railway of ["JR-East.JobanLocal", "JR-East.ChuoSobuLocal", "SaitamaRailway.SaitamaRailway", "Keio.Keio", "Keikyu.Main", "TokyoMetro.Ginza", "Sotetsu.Main"]) {
    assert.equal(railwayAsset(`odpt.Railway:${railway}`), unknownAsset, railway);
  }
  assert.equal(railwayAsset("odpt.Railway:TokyoMetro.Ginza", "G03"), unknownAsset);
});
