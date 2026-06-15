#!/usr/bin/env node
import { main } from "../src/galcode.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(`Galcode failed: ${error.message}`);
  if (process.env.GALCODE_DEBUG === "1") {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
