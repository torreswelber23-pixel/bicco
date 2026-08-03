#!/usr/bin/env node
/**
 * Gera o par de chaves RSA usado pelo endpoint de dados do Flow.
 *
 *   node scripts/generate-keys.mjs [--passphrase "algo"]
 *
 * A pública vai para a Meta (scripts/publish-flow.mjs --upload-key); a privada
 * vira a variável FLOW_PRIVATE_KEY. A pasta keys/ está no .gitignore.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const passIndex = args.indexOf("--passphrase");
const passphrase = passIndex >= 0 ? args[passIndex + 1] : undefined;

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
    ...(passphrase
      ? { cipher: "aes-256-cbc", passphrase }
      : {}),
  },
});

const dir = path.join(process.cwd(), "keys");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "public.pem"), publicKey, { mode: 0o600 });
fs.writeFileSync(path.join(dir, "private.pem"), privateKey, { mode: 0o600 });

console.log("Chaves geradas em keys/ (fora do git).\n");
console.log("1) Envie a pública para a Meta:");
console.log("     node scripts/publish-flow.mjs --upload-key\n");
console.log("2) Coloque a privada no .env.local / nas env vars da Vercel.");
console.log("   Em uma linha só, com \\n literais:\n");
console.log(`FLOW_PRIVATE_KEY="${privateKey.trimEnd().replace(/\n/g, "\\n")}"`);
if (passphrase) {
  console.log(`FLOW_PRIVATE_KEY_PASSPHRASE="${passphrase}"`);
}
