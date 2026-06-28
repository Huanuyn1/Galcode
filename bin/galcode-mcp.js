#!/usr/bin/env node
import { startMcpServer } from "../src/mcp/server.mjs";

startMcpServer().catch((error) => {
  console.error(`Galcode MCP failed: ${error.message}`);
  if (process.env.GALCODE_DEBUG === "1") {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
