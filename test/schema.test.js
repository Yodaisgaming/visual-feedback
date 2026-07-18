import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, newBatch, testBatch } from "../extension/lib/schema.js";

test("newBatch carries schema version, ids, and empty annotations", () => {
  const b = newBatch("https://example.com/", { w: 1, h: 2, dpr: 1 }, { host: "example.com" });
  assert.equal(b.schemaVersion, SCHEMA_VERSION);
  assert.match(b.batchId, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(b.createdAt)));
  assert.equal(b.pageUrl, "https://example.com/");
  assert.deepEqual(b.annotations, []);
});

test("newBatch nulls missing page context instead of leaving it undefined", () => {
  const b = newBatch(null, null, null);
  assert.equal(b.pageUrl, null);
  assert.equal(b.site, null);
  assert.equal(b.viewport, null);
});

test("testBatch fixture matches the real capture output shape", () => {
  const [ann] = testBatch().annotations;
  assert.equal(ann.n, 1);
  assert.equal(ann.anchor.selector, "#cta-primary");
  // capture() camel-cases computed CSS property names: background-color -> backgroundColor
  assert.ok("backgroundColor" in ann.cssBefore);
  assert.ok(!("background" in ann.cssBefore));
  for (const v of Object.values(ann.cssBefore)) assert.equal(typeof v, "string");
});
