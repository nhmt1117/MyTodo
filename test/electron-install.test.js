const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

test("Electron's ZIP extractor finishes large entries on the build Node version", { timeout: 10000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mytodo-unzip-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const electronRequire = createRequire(require.resolve("electron/package.json"));
  const extractorPath = electronRequire.resolve("@electron-internal/extract-zip");
  const { extract } = await import(pathToFileURL(extractorPath).href);
  const { ZipArchive } = await import("archiver");
  const zip = new ZipArchive();
  const content = Buffer.alloc(256 * 1024, 65);
  zip.append(content, { name: "locales/sample.pak" });
  zip.append(Buffer.from("complete"), { name: "last.txt" });
  const archive = path.join(directory, "test.zip");
  const completed = pipeline(zip, fs.createWriteStream(archive));
  await zip.finalize();
  await completed;
  const output = path.join(directory, "output");
  await extract(archive, { dir: output });
  assert.deepEqual(fs.readFileSync(path.join(output, "locales/sample.pak")), content);
  assert.equal(fs.readFileSync(path.join(output, "last.txt"), "utf8"), "complete");
});
