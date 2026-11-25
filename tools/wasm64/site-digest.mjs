import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const files = [];
async function visit(dir) {
  for (const entry of await readdir(resolve(root, dir), {
    withFileTypes: true,
  })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Not a regular site entry: ${path}`);
  }
}
await visit("");
if (!files.includes("index.html") || !files.includes("environment.json"))
  throw new Error("Not a complete WASM64 site");
const tree = createHash("sha256");
for (const path of files.sort()) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(resolve(root, path)))
    hash.update(chunk);
  tree.update(`${hash.digest("hex")}\0${path}\0`);
}
console.log(tree.digest("hex"));
