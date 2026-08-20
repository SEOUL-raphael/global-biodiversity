import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexPath = path.resolve(__dirname, "..", "..", "lib", "api-zod", "src", "index.ts");

const content = `export * from "./generated/api";\n`;

writeFileSync(indexPath, content, "utf-8");
console.log("Fixed lib/api-zod/src/index.ts — removed duplicate types re-export.");
