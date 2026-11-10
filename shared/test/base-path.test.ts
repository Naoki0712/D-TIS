import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBasePath, siteBaseFromAppBase } from "../base-path";

test("Pages bases support root, repository paths, and app directories", () => {
  assert.equal(normalizeBasePath(""), "/");
  assert.equal(normalizeBasePath("D-TIS"), "/D-TIS/");
  assert.equal(normalizeBasePath("/D-TIS/"), "/D-TIS/");
  assert.equal(siteBaseFromAppBase("/D-TIS/signage/"), "/D-TIS/");
  assert.equal(siteBaseFromAppBase("/D-TIS/controller/"), "/D-TIS/");
  assert.equal(siteBaseFromAppBase("/controller/"), "/");
  assert.equal(siteBaseFromAppBase("/nested/site/"), "/nested/site/");
});

test("malformed Pages bases cannot turn links into external URLs or traversals", () => {
  for (const value of ["https://example.com", "/../", "/a/./b/", "/a//b/", "/a?b", "/a#b", "/a\\b", "/a b"]) {
    assert.throws(() => normalizeBasePath(value), /PAGES_BASE/, value);
  }
});
