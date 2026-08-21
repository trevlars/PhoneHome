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

// Cache-bust app.js / app.css so iOS Safari doesn't keep a pre-HTTPS bundle.
const v = Date.now().toString(36);
const indexPath = path.join(dest, "index.html");
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, "utf8");
  html = html
    .replace(/(href="\/app\.css)(?:\?[^"]*)?(")/, `$1?v=${v}$2`)
    .replace(/(src="\/app\.js)(?:\?[^"]*)?(")/, `$1?v=${v}$2`);
  fs.writeFileSync(indexPath, html);
  console.log(`web: cache-bust v=${v}`);
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
