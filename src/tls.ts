// Self-signed HTTPS cert for the LAN-facing server. iOS Safari (and other
// modern browsers) only grant camera access (getUserMedia) inside a "secure
// context" — https:// or localhost — so devices connecting over the LAN IP
// need https to use the point-card QR scanner. There's no fixed domain to get
// a real certificate for (portable USB deployment, IP differs per venue), so
// we generate a self-signed cert covering whatever LAN IP(s) are detected at
// startup and persist it under bin/certs/, only regenerating when the file is
// missing, expired, or no longer covers the current IP(s) — regenerating on
// every boot would force every device (teacher + every student iPad) to
// re-click through the browser's "not secure" warning every single time.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generate as generateSelfSigned } from "selfsigned";
import { getBinDir } from "./paths";
import { getAllLocalIps } from "./utils/network";

function getCertPaths() {
  const dir = path.join(getBinDir(), "certs");
  return { dir, certPath: path.join(dir, "server.crt"), keyPath: path.join(dir, "server.key") };
}

function currentSanTargets(): string[] {
  return [...new Set([...getAllLocalIps(), "127.0.0.1", "localhost"])];
}

/** True if the existing cert is still usable: not expired (30-day buffer) and
 *  its SAN list already covers every IP we currently see. */
function isCertStillValid(certPem: string, targets: string[]): boolean {
  try {
    const x509 = new crypto.X509Certificate(certPem);
    const expiresAt = new Date(x509.validTo).getTime();
    const bufferMs = 30 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(expiresAt) || expiresAt - Date.now() < bufferMs) return false;

    const san = x509.subjectAltName ?? "";
    for (const target of targets) {
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(target);
      const needle = isIp ? `IP Address:${target}` : `DNS:${target}`;
      if (!san.includes(needle)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns `{ key, cert }` PEM buffers ready for https.createServer(), reusing
 *  the persisted self-signed cert in bin/certs/ when it's still valid for the
 *  IP(s) this machine currently has, otherwise generating and persisting a
 *  fresh one (long-lived — 10 years — since this is a local trust-on-first-use
 *  cert, not one that's ever meant to be publicly re-issued/rotated). */
export async function getOrCreateHttpsOptions(): Promise<{ key: Buffer; cert: Buffer }> {
  const { dir, certPath, keyPath } = getCertPaths();
  const targets = currentSanTargets();

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const certPem = fs.readFileSync(certPath, "utf-8");
    if (isCertStillValid(certPem, targets)) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    }
  }

  const altNames = targets.map((target) =>
    /^\d{1,3}(\.\d{1,3}){3}$/.test(target) ? { type: 7 as const, ip: target } : { type: 2 as const, value: target }
  );
  const pems = await generateSelfSigned([{ name: "commonName", value: "MyClass" }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "subjectAltName", altNames },
    ],
  });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);

  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert) };
}
