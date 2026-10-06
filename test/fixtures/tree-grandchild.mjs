// Test fixture: leaf of the process tree. Holds an HTTP port (like the vite
// dev server) and records its pid only once the server is listening.
import { appendFileSync } from "node:fs";
import http from "node:http";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("fixture");
});
server.listen(Number(process.env.TREE_PORT), "127.0.0.1", () => {
  appendFileSync(process.env.TREE_PID_FILE, `${process.pid}\n`, "utf8");
});
setInterval(() => {}, 1000);
