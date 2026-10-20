import { createHash } from "node:crypto";
import { Codes } from "../contract";
import type { Diagnostic } from "../contract";
import { err, warn } from "../diagnostics";
import type { PackContainer } from "../pack/container";
import { CATALOG_SNAPSHOT_PATH, lintCatalog } from "../verdict/catalog";

/**
 * The metric catalog snapshot (decision 0048), at any status: a
 * run.yaml `metrics_catalog` block must name a snapshot that exists, passes
 * the catalog lint, hashes to the recorded sha256 and carries the recorded id
 * and version. A snapshot nobody references is only a warning.
 */
export async function runCatalogChecks(input: { run: any; container: PackContainer }): Promise<Diagnostic[]> {
  const block = input.run?.metrics_catalog;
  const bytes = await input.container.readFileBytes(CATALOG_SNAPSHOT_PATH);
  if (block === undefined || block === null || typeof block !== "object") {
    return bytes == null
      ? []
      : [warn(Codes.CATALOG_UNREFERENCED, CATALOG_SNAPSHOT_PATH, `${CATALOG_SNAPSHOT_PATH} is present but run.yaml has no metrics_catalog block`)];
  }
  if (bytes == null) {
    return [err(Codes.CATALOG_MISSING, "run.yaml#/metrics_catalog", `run.yaml names catalog "${block.id}" but ${CATALOG_SNAPSHOT_PATH} is missing`)];
  }

  const diags: Diagnostic[] = [];
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (typeof block.sha256 === "string" && /^[0-9a-f]{64}$/.test(block.sha256) && block.sha256 !== actual) {
    diags.push(err(Codes.CATALOG_HASH_MISMATCH, "run.yaml#/metrics_catalog/sha256", `metrics_catalog.sha256 ${block.sha256} does not match the snapshot hash ${actual}`));
  }
  const { catalog, diagnostics } = lintCatalog(bytes.toString("utf8"), { location: CATALOG_SNAPSHOT_PATH });
  diags.push(...diagnostics);
  if (catalog && (catalog.id !== block.id || String(catalog.version) !== String(block.version))) {
    diags.push(err(Codes.CATALOG_IDENTITY_MISMATCH, "run.yaml#/metrics_catalog", `run.yaml names catalog ${block.id} v${block.version} but the snapshot is ${catalog.id} v${catalog.version}`));
  }
  return diags;
}
