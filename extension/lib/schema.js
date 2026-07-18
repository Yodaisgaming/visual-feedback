export const SCHEMA_VERSION = 1;

export function newBatch(pageUrl, viewport, site) {
  return {
    schemaVersion: SCHEMA_VERSION,
    batchId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    pageUrl: pageUrl || null,
    site: site || null,
    viewport: viewport || null,
    annotations: [],
  };
}

export function testBatch() {
  const batch = newBatch(
    "https://example.com/",
    { w: 1440, h: 900, dpr: 2 },
    { host: "example.com" }
  );
  batch.annotations.push({
    n: 1,
    comment: "TEST annotation proving the inbox write works.",
    frameUrl: null,
    anchor: {
      tag: "a",
      id: "cta-primary",
      testid: null,
      ariaLabel: "Sign up",
      text: "Sign up",
      selector: "#cta-primary",
      domPath: "main > section.hero > a.btn",
      instance: "1 of 1",
      stableClasses: ["btn", "btn-primary"],
      noisyClasses: ["css-1x7a2b"],
    },
    box: { x: 640, y: 520, w: 180, h: 44 },
    cssBefore: {
      fontSize: "13px",
      fontWeight: "600",
      padding: "6px 10px",
      color: "#ffffff",
      backgroundColor: "#0c254d",
      display: "inline-block",
    },
    screenshot: null,
  });
  return batch;
}
