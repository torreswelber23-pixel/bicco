import crypto from "node:crypto";

/**
 * Criptografia do endpoint de dados do WhatsApp Flows.
 *
 * O protocolo da Meta é híbrido:
 *
 *  1. O cliente gera uma chave AES efêmera por sessão e a envia cifrada com a
 *     nossa chave pública RSA (OAEP/SHA-256) no campo `encrypted_aes_key`.
 *  2. O corpo real (`encrypted_flow_data`) vem cifrado em AES-GCM com essa
 *     chave. O authentication tag são os últimos 16 bytes do payload.
 *  3. A resposta usa a MESMA chave AES, mas com o IV invertido bit a bit, e é
 *     devolvida como base64 puro (text/plain), não JSON.
 *
 * Qualquer falha de decifragem deve virar HTTP 421 para que o cliente descarte
 * a chave de sessão e refaça o handshake.
 */

const TAG_LENGTH = 16;

export class FlowDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FlowDecryptionError";
  }
}

export interface EncryptedFlowRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

export interface DecryptedFlowRequest {
  /** Corpo já em JSON, pronto para o handler de negócio. */
  body: FlowRequestBody;
  /** Chave AES da sessão, necessária para cifrar a resposta. */
  aesKey: Buffer;
  /** IV original recebido; a resposta usa a versão invertida. */
  initialVector: Buffer;
}

export interface FlowRequestBody {
  version: string;
  action: "INIT" | "BACK" | "data_exchange" | "ping";
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
}

export function isEncryptedFlowRequest(
  value: unknown,
): value is EncryptedFlowRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.encrypted_flow_data === "string" &&
    typeof candidate.encrypted_aes_key === "string" &&
    typeof candidate.initial_vector === "string"
  );
}

export function decryptRequest(
  request: EncryptedFlowRequest,
  privateKeyPem: string,
  passphrase?: string,
): DecryptedFlowRequest {
  let aesKey: Buffer;
  try {
    aesKey = crypto.privateDecrypt(
      {
        key: crypto.createPrivateKey({
          key: privateKeyPem,
          ...(passphrase ? { passphrase } : {}),
        }),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(request.encrypted_aes_key, "base64"),
    );
  } catch (error) {
    throw new FlowDecryptionError(
      "Não foi possível decifrar a chave AES. A chave pública registrada no Flow provavelmente não corresponde à privada configurada.",
      { cause: error },
    );
  }

  const initialVector = Buffer.from(request.initial_vector, "base64");
  const encryptedBody = Buffer.from(request.encrypted_flow_data, "base64");

  if (encryptedBody.length <= TAG_LENGTH) {
    throw new FlowDecryptionError("Payload cifrado menor que o auth tag.");
  }

  const ciphertext = encryptedBody.subarray(0, -TAG_LENGTH);
  const authTag = encryptedBody.subarray(-TAG_LENGTH);

  let plaintext: string;
  try {
    const decipher = crypto.createDecipheriv(
      aesCipherFor(aesKey),
      aesKey,
      initialVector,
    );
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf-8");
  } catch (error) {
    throw new FlowDecryptionError("Falha ao decifrar o corpo do Flow.", {
      cause: error,
    });
  }

  let body: FlowRequestBody;
  try {
    body = JSON.parse(plaintext) as FlowRequestBody;
  } catch (error) {
    throw new FlowDecryptionError("Corpo decifrado não é um JSON válido.", {
      cause: error,
    });
  }

  return { body, aesKey, initialVector };
}

export function encryptResponse(
  response: unknown,
  aesKey: Buffer,
  initialVector: Buffer,
): string {
  // O cliente espera a resposta cifrada com o IV invertido bit a bit.
  const flippedIv = Buffer.from(initialVector.map((byte) => ~byte & 0xff));

  const cipher = crypto.createCipheriv(
    aesCipherFor(aesKey),
    aesKey,
    flippedIv,
  );

  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

/** A Meta pode negociar AES-128 ou AES-256; escolhemos pelo tamanho da chave. */
function aesCipherFor(aesKey: Buffer): crypto.CipherGCMTypes {
  switch (aesKey.length) {
    case 16:
      return "aes-128-gcm";
    case 32:
      return "aes-256-gcm";
    default:
      throw new FlowDecryptionError(
        `Tamanho de chave AES inesperado: ${aesKey.length} bytes.`,
      );
  }
}
