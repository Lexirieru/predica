import { authMiddleware } from "../../src/lib/middleware";
import { getAuthMessage } from "../../src/lib/auth";
import { Request, Response, NextFunction } from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

describe("Security Middleware - Solana Signature Verification", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction = jest.fn();

  const keypair = nacl.sign.keyPair();
  const wallet = bs58.encode(keypair.publicKey);
  const secretKey = keypair.secretKey;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      body: { userWallet: wallet }
    };
    mockResponse = {
      status: jest.fn().mockReturnThis() as any,
      json: jest.fn().mockReturnThis() as any
    };
    nextFunction = jest.fn();
  });

  it("should pass for a valid signature and timestamp", () => {
    const timestamp = Date.now();
    const action = "VOTE";
    const message = getAuthMessage(action, wallet, timestamp);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));

    mockRequest.headers = {
      "x-signature": signature,
      "x-timestamp": timestamp.toString()
    };

    authMiddleware(action)(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it("should fail (401) if signature header is missing", () => {
    mockRequest.headers = {
      "x-timestamp": Date.now().toString()
    };

    authMiddleware("VOTE")(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Missing authentication headers") }));
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it("should fail (401) if signature is invalid", () => {
    const timestamp = Date.now();
    mockRequest.headers = {
      "x-signature": bs58.encode(Buffer.alloc(64, 1)),
      "x-timestamp": timestamp.toString()
    };

    authMiddleware("VOTE")(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Invalid signature") }));
  });

  it("should fail (401) if request is expired (Replay Attack Protection)", () => {
    const action = "VOTE";
    const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const message = getAuthMessage(action, wallet, expiredTimestamp);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));

    mockRequest.headers = {
      "x-signature": signature,
      "x-timestamp": expiredTimestamp.toString()
    };

    authMiddleware(action)(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Request expired") }));
  });

  it("should fail (401) if timestamp is in the future", () => {
    const action = "VOTE";
    const futureTimestamp = Date.now() + 10 * 60 * 1000; // 10 minutes in future
    const message = getAuthMessage(action, wallet, futureTimestamp);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));

    mockRequest.headers = {
      "x-signature": signature,
      "x-timestamp": futureTimestamp.toString()
    };

    authMiddleware(action)(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Request expired") }));
  });
});
