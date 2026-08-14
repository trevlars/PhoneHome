import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "src");
const dest = path.join(__dirname, "public");

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log(`web: copied ${fs.readdirSync(src).length} files to public/`);

if (process.argv.includes("--watch")) {
  fs.watch(src, { recursive: true }, () => {
    for (const file of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
    }
    console.log("web: rebuilt");
  });
}
