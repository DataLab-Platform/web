import { expect, it } from "vitest";
import {
  backingBytes,
  beginRecording,
  recordResult,
  transferReport,
} from "../../../src/runtime/benchmarkTransfer";

it("counts distinct backing stores even with no transfer list; rejects a tiny heap subview", () => {
  const buf = new Float32Array(4096);
  const rows = [buf.subarray(0, 1), buf.subarray(1, 2)];
  expect(backingBytes({ rows, copy: rows[0] })).toBe(buf.byteLength);
  beginRecording();
  expect(() =>
    recordResult("worker", "snapshot", {
      images: [{ width: 1, height: 2, data: rows }],
    }),
  ).toThrow();
  const small = new Float32Array(2);
  recordResult("python", "get_image_view_snapshot", {
    images: [{ width: 1, height: 2, data: small }],
  });
  recordResult("worker", "getImageViewSnapshot", {
    images: [
      { width: 1, height: 2, data: [small.subarray(0, 1), small.subarray(1)] },
    ],
  });
  expect(
    transferReport().map((e) => [e.boundary, e.pixels, e.backing]),
  ).toEqual([
    ["python", 8, 8],
    ["worker", 8, 8],
  ]);
});
