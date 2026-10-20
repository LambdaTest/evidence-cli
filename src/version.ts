// package.json sits one level above both src/ and dist/.
const pkg = require("../package.json") as { version: string };

/** The evidence-cli package version. */
export const VERSION: string = pkg.version;
