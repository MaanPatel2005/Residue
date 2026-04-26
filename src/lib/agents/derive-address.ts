/**
 * Derives a Fetch.ai uAgent address from a seed phrase.
 *
 * Mirrors the Python uagents_core.identity algorithm exactly:
 *   1. key_derivation_hash = SHA256("agent" + byte(0))
 *   2. seed_hash           = SHA256(seed)
 *   3. private_key          = SHA256(key_derivation_hash + seed_hash)
 *   4. public_key           = SECP256k1 compressed point (33 bytes)
 *   5. address              = bech32_encode("agent", public_key)
 */

import { createHash } from 'crypto';

import * as secp from '@noble/secp256k1';
import { bech32 } from 'bech32';

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

export function deriveAgentAddress(seed: string, index = 0): string {
  const keyDerivHash = sha256(
    Buffer.concat([Buffer.from('agent', 'utf-8'), Buffer.from([index])]),
  );

  const seedHash = sha256(Buffer.from(seed, 'utf-8'));

  const privateKey = sha256(Buffer.concat([keyDerivHash, seedHash]));

  const publicKey = secp.getPublicKey(privateKey, true); // compressed, 33 bytes

  const words = bech32.toWords(Buffer.from(publicKey));
  return bech32.encode('agent', words);
}
