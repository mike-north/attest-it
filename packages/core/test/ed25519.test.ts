/**
 * Tests for Ed25519 cryptographic operations.
 */

import { describe, it, expect } from 'vitest'
import * as ed25519 from '../src/crypto/ed25519.js'

describe('Ed25519 Cryptography', () => {
  describe('generateKeyPair', () => {
    it('should generate a valid keypair', () => {
      const keyPair = ed25519.generateKeyPair()

      // Public key should be base64-encoded 32 bytes (~44 characters)
      expect(keyPair.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
      expect(Buffer.from(keyPair.publicKey, 'base64')).toHaveLength(32)

      // Private key should be PEM format
      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----')
      expect(keyPair.privateKey).toContain('-----END PRIVATE KEY-----')
    })

    it('should generate different keypairs on each call', () => {
      const keyPair1 = ed25519.generateKeyPair()
      const keyPair2 = ed25519.generateKeyPair()

      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey)
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey)
    })
  })

  describe('sign and verify', () => {
    it('should successfully sign and verify data (string)', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'Hello, World!'

      const signature = ed25519.sign(data, keyPair.privateKey)

      // Signature should be base64-encoded
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/)

      // Verification should succeed with correct key
      const isValid = ed25519.verify(data, signature, keyPair.publicKey)
      expect(isValid).toBe(true)
    })

    it('should successfully sign and verify data (Buffer)', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = Buffer.from('Binary data test', 'utf8')

      const signature = ed25519.sign(data, keyPair.privateKey)

      // Verification should succeed
      const isValid = ed25519.verify(data, signature, keyPair.publicKey)
      expect(isValid).toBe(true)
    })

    it('should handle empty data', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = ''

      const signature = ed25519.sign(data, keyPair.privateKey)
      const isValid = ed25519.verify(data, signature, keyPair.publicKey)

      expect(isValid).toBe(true)
    })

    it('should handle empty Buffer', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = Buffer.from([])

      const signature = ed25519.sign(data, keyPair.privateKey)
      const isValid = ed25519.verify(data, signature, keyPair.publicKey)

      expect(isValid).toBe(true)
    })

    it('should handle large data', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'x'.repeat(100000) // 100KB of data

      const signature = ed25519.sign(data, keyPair.privateKey)
      const isValid = ed25519.verify(data, signature, keyPair.publicKey)

      expect(isValid).toBe(true)
    })

    it('should fail verification with wrong public key', () => {
      const keyPair1 = ed25519.generateKeyPair()
      const keyPair2 = ed25519.generateKeyPair()
      const data = 'Test data'

      const signature = ed25519.sign(data, keyPair1.privateKey)

      // Verification should fail with wrong key
      const isValid = ed25519.verify(data, signature, keyPair2.publicKey)
      expect(isValid).toBe(false)
    })

    it('should fail verification with tampered data', () => {
      const keyPair = ed25519.generateKeyPair()
      const originalData = 'Original data'
      const tamperedData = 'Tampered data'

      const signature = ed25519.sign(originalData, keyPair.privateKey)

      // Verification should fail with different data
      const isValid = ed25519.verify(tamperedData, signature, keyPair.publicKey)
      expect(isValid).toBe(false)
    })

    it('should fail verification with tampered signature', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'Test data'

      const signature = ed25519.sign(data, keyPair.privateKey)

      // Tamper with signature by flipping a bit
      const signatureBuffer = Buffer.from(signature, 'base64')
      signatureBuffer[0] = signatureBuffer[0] ^ 0xff
      const tamperedSignature = signatureBuffer.toString('base64')

      // Verification should fail
      const isValid = ed25519.verify(data, tamperedSignature, keyPair.publicKey)
      expect(isValid).toBe(false)
    })

    it('should fail verification with invalid signature format', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'Test data'

      // Invalid base64 gets decoded but produces invalid signature
      const isValid = ed25519.verify(data, 'not-valid-base64!!!', keyPair.publicKey)
      expect(isValid).toBe(false)
    })

    it('should fail with invalid public key length', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'Test data'
      const signature = ed25519.sign(data, keyPair.privateKey)

      // Public key that's not 32 bytes
      const invalidPublicKey = Buffer.from('too short').toString('base64')

      expect(() => ed25519.verify(data, signature, invalidPublicKey)).toThrow(/Invalid Ed25519 public key length/)
    })

    it('should fail with malformed private key', () => {
      const data = 'Test data'
      const invalidPrivateKey = '-----BEGIN PRIVATE KEY-----\nINVALID\n-----END PRIVATE KEY-----'

      expect(() => ed25519.sign(data, invalidPrivateKey)).toThrow(/Failed to sign/)
    })
  })

  describe('getPublicKeyFromPrivate', () => {
    it('should extract correct public key from private key', () => {
      const keyPair = ed25519.generateKeyPair()

      const extractedPublicKey = ed25519.getPublicKeyFromPrivate(keyPair.privateKey)

      // Should match the original public key
      expect(extractedPublicKey).toBe(keyPair.publicKey)
    })

    it('should allow signing and verification with extracted public key', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'Test data'

      // Sign with private key
      const signature = ed25519.sign(data, keyPair.privateKey)

      // Extract public key
      const extractedPublicKey = ed25519.getPublicKeyFromPrivate(keyPair.privateKey)

      // Verify with extracted public key
      const isValid = ed25519.verify(data, signature, extractedPublicKey)
      expect(isValid).toBe(true)
    })

    it('should fail with malformed private key', () => {
      const invalidPrivateKey = '-----BEGIN PRIVATE KEY-----\nINVALID\n-----END PRIVATE KEY-----'

      expect(() => ed25519.getPublicKeyFromPrivate(invalidPrivateKey)).toThrow(/Failed to extract/)
    })

    it('should fail with wrong key type', () => {
      const wrongKeyType = '-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAA\n-----END RSA PRIVATE KEY-----'

      expect(() => ed25519.getPublicKeyFromPrivate(wrongKeyType)).toThrow()
    })
  })

  describe('key format validation', () => {
    it('should produce signatures of consistent length', () => {
      const keyPair = ed25519.generateKeyPair()
      const data1 = 'short'
      const data2 = 'a much longer string with more data to sign'

      const sig1 = ed25519.sign(data1, keyPair.privateKey)
      const sig2 = ed25519.sign(data2, keyPair.privateKey)

      // Ed25519 signatures are always 64 bytes
      const sig1Buffer = Buffer.from(sig1, 'base64')
      const sig2Buffer = Buffer.from(sig2, 'base64')

      expect(sig1Buffer).toHaveLength(64)
      expect(sig2Buffer).toHaveLength(64)
    })

    it('should handle special characters in data', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = '🎉 Special chars: \n\t\r\0 ñoño'

      const signature = ed25519.sign(data, keyPair.privateKey)
      const isValid = ed25519.verify(data, signature, keyPair.publicKey)

      expect(isValid).toBe(true)
    })

    it('should be deterministic (same data produces same signature)', () => {
      const keyPair = ed25519.generateKeyPair()
      const data = 'Deterministic test'

      const sig1 = ed25519.sign(data, keyPair.privateKey)
      const sig2 = ed25519.sign(data, keyPair.privateKey)

      // Ed25519 is deterministic
      expect(sig1).toBe(sig2)
    })
  })

  describe('cross-validation', () => {
    it('should work with string and Buffer interchangeably', () => {
      const keyPair = ed25519.generateKeyPair()
      const dataString = 'Test data'
      const dataBuffer = Buffer.from(dataString, 'utf8')

      // Sign with string, verify with Buffer
      const sig1 = ed25519.sign(dataString, keyPair.privateKey)
      expect(ed25519.verify(dataBuffer, sig1, keyPair.publicKey)).toBe(true)

      // Sign with Buffer, verify with string
      const sig2 = ed25519.sign(dataBuffer, keyPair.privateKey)
      expect(ed25519.verify(dataString, sig2, keyPair.publicKey)).toBe(true)
    })
  })
})
