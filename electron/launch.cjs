// Editor-integrated terminals (VS Code, Cursor) export ELECTRON_RUN_AS_NODE=1.
// Inheriting it makes the electron binary boot as plain Node, with no window and
// no `electron` module, so it is stripped before spawning.
const { spawn } = require("node:child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("close", (code) => process.exit(code ?? 0));
