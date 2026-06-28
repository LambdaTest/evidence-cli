// Copies the canonical schema JSON next to the compiled registry so the
// published dist/ package can require() them. src/schemas remains the single
// authored source of truth (decision 0038).
import { cpSync } from "node:fs";

cpSync("src/schemas", "dist/schemas", {
  recursive: true,
  filter: (src) => !src.endsWith(".ts"),
});
console.log("copied src/schemas/**/*.json -> dist/schemas");
