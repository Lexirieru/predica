import { verifySolanaSignature, getAuthMessage } from "../../src/lib/auth";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { describe, it, expect } from "@jest/globals";

describe("Auth Library - Solana Signature Verification", () => {
  // Generate a test keypair
  const keypair = nacl.sign.keyPair();
  const publicKeyBase58 = bs58.encode(keypair.publicKey);
  const secretKey = keypair.secretKey;

  it("should verify a valid Solana signature", () => {
    const timestamp = Date.now();
    const message = getAuthMessage("VOTE", publicKeyBase58, timestamp);
    const msgUint8 = new TextEncoder().encode(message);
    
    // Sign the message
    const signatureUint8 = nacl.sign.detached(msgUint8, secretKey);
    const signatureBase58 = bs58.encode(signatureUint8);

    const isValid = verifySolanaSignature(message, signatureBase58, publicKeyBase58);
    expect(isValid).toBe(true);
  });

  it("should fail for an invalid signature", () => {
    const message = "Invalid message";
    const fakeSignature = bs58.encode(Buffer.alloc(64, 1));
    
    const isValid = verifySolanaSignature(message, fakeSignature, publicKeyBase58);
    expect(isValid).toBe(false);
  });

  it("should fail if public key is for a different signer", () => {
    const message = "VOTE";
    const msgUint8 = new TextEncoder().encode(message);
    const signatureUint8 = nacl.sign.detached(msgUint8, secretKey);
    const signatureBase58 = bs58.encode(signatureUint8);

    // Another keypair
    const anotherKeypair = nacl.sign.keyPair();
    const anotherPublicKey = bs58.encode(anotherKeypair.publicKey);

    const isValid = verifySolanaSignature(message, signatureBase58, anotherPublicKey);
    expect(isValid).toBe(false);
  });

  it("should fail if message is tampered with", () => {
    const message = "VOTE_OK";
    const msgUint8 = new TextEncoder().encode(message);
    const signatureUint8 = nacl.sign.detached(msgUint8, secretKey);
    const signatureBase58 = bs58.encode(signatureUint8);

    const tamperedMessage = "VOTE_NOT_OK";
    const isValid = verifySolanaSignature(tamperedMessage, signatureBase58, publicKeyBase58);
    expect(isValid).toBe(false);
  });
});
