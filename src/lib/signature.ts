import crypto from "node:crypto";

/**
 * Valida o header X-Hub-Signature-256 que a Meta envia em todo POST.
 *
 * Precisa ser calculado sobre o corpo BRUTO da requisição — reserializar o JSON
 * muda os bytes e invalida a assinatura.
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf-8")
    .digest("hex");

  const received = signatureHeader.slice("sha256=".length);

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
