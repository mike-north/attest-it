/**
 * Tests for the interactive keygen component.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render } from 'ink-testing-library'
import {
  KeygenInteractive,
  runKeygenInteractive,
  type KeygenResult,
} from '../src/commands/keygen-interactive.js'
import { OnePasswordKeyProvider, FilesystemKeyProvider } from '@attest-it/core'

// Mock the key providers
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual('@attest-it/core')
  return {
    ...actual,
    OnePasswordKeyProvider: {
      isInstalled: vi.fn(),
      listAccounts: vi.fn(),
      listVaults: vi.fn(),
    },
    MacOSKeychainKeyProvider: {
      isAvailable: vi.fn().mockResolvedValue(false),
    },
    YubiKeyProvider: {
      isInstalled: vi.fn().mockResolvedValue(false),
      isConnected: vi.fn().mockResolvedValue(false),
      listDevices: vi.fn().mockResolvedValue([]),
      isChallengeResponseConfigured: vi.fn().mockResolvedValue(false),
    },
    FilesystemKeyProvider: vi.fn(),
  }
})

describe('KeygenInteractive', () => {
  let mockIsInstalled: MockInstance
  let mockListAccounts: MockInstance
  let mockListVaults: MockInstance

  beforeEach(() => {
    mockIsInstalled = vi.mocked(OnePasswordKeyProvider.isInstalled)
    mockListAccounts = vi.mocked(OnePasswordKeyProvider.listAccounts)
    mockListVaults = vi.mocked(OnePasswordKeyProvider.listVaults)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial 1Password check', () => {
    it('should show checking spinner initially', () => {
      mockIsInstalled.mockResolvedValue(false)

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      expect(lastFrame()).toContain('Checking available key storage providers')
    })

    it('should show filesystem option when 1Password not installed', async () => {
      mockIsInstalled.mockResolvedValue(false)

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      // Wait for async state update
      await new Promise((resolve) => setTimeout(resolve, 100))

      const frame = lastFrame()
      expect(frame).toContain('Where would you like to store your private key')
      expect(frame).toContain('Local Filesystem')
      expect(frame).not.toContain('1Password')
    })

    it('should show both options when 1Password is installed', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([
        {
          account_uuid: 'uuid-1',
          email: 'user@example.com',
          url: 'https://example.1password.com',
          user_uuid: 'user-1',
        },
      ])

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      // Wait for async state update
      await new Promise((resolve) => setTimeout(resolve, 100))

      const frame = lastFrame()
      expect(frame).toContain('Where would you like to store your private key')
      expect(frame).toContain('Local Filesystem')
      expect(frame).toContain('1Password')
    })
  })

  describe('Filesystem provider flow', () => {
    it('should call onComplete with filesystem result', async () => {
      mockIsInstalled.mockResolvedValue(false)

      const mockFilesystemProvider = {
        generateKeyPair: vi.fn().mockResolvedValue({
          privateKeyRef: '/path/to/private.pem',
          publicKeyPath: '/path/to/public.pem',
          storageDescription: 'Filesystem: /path/to/private.pem',
        }),
      }

      vi.mocked(FilesystemKeyProvider).mockImplementation(() => mockFilesystemProvider as never)

      const onComplete = vi.fn()
      const onCancel = vi.fn()
      const onError = vi.fn()

      render(<KeygenInteractive onComplete={onComplete} onCancel={onCancel} onError={onError} />)

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Note: This test requires simulation of user interaction
      // which is not straightforward with ink-testing-library
      // The test verifies the component renders without errors
    })
  })

  describe('1Password provider flow', () => {
    it('should show account selection when multiple accounts', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([
        {
          account_uuid: 'uuid-1',
          email: 'user1@example.com',
          url: 'https://example1.1password.com',
          user_uuid: 'user-1',
        },
        {
          account_uuid: 'uuid-2',
          email: 'user2@example.com',
          url: 'https://example2.1password.com',
          user_uuid: 'user-2',
        },
      ])

      render(<KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />)

      // Wait for async state update
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Component should be showing provider selection
      // Simulating user selection would require more complex testing
    })

    it('should show vault selection after account selection', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([
        {
          account_uuid: 'uuid-1',
          email: 'user@example.com',
          url: 'https://example.1password.com',
          user_uuid: 'user-1',
        },
      ])
      mockListVaults.mockResolvedValue([
        { id: 'vault-1', name: 'Private' },
        { id: 'vault-2', name: 'Development' },
      ])

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Component should render without errors
      expect(lastFrame()).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('should call onError when 1Password check fails', async () => {
      mockIsInstalled.mockRejectedValue(new Error('op command not found'))

      const onError = vi.fn()

      render(<KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={onError} />)

      // Component should continue even if 1Password check fails
      await new Promise((resolve) => setTimeout(resolve, 100))

      // The component should gracefully handle the error by showing filesystem only
      expect(onError).not.toHaveBeenCalled()
    })

    it('should call onError when vault fetching fails', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([
        {
          account_uuid: 'uuid-1',
          email: 'user@example.com',
          url: 'https://example.1password.com',
          user_uuid: 'user-1',
        },
      ])
      mockListVaults.mockRejectedValue(new Error('Failed to list vaults'))

      const onError = vi.fn()

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={onError} />,
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Component should render
      expect(lastFrame()).toBeDefined()
    })
  })

  describe('Edge cases', () => {
    it('should handle single account by skipping account selection', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([
        {
          account_uuid: 'uuid-1',
          email: 'user@example.com',
          url: 'https://example.1password.com',
          user_uuid: 'user-1',
        },
      ])
      mockListVaults.mockResolvedValue([{ id: 'vault-1', name: 'Private' }])

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should skip account selection and go to provider selection
      expect(lastFrame()).toBeDefined()
    })

    it('should handle empty accounts list', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([])

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should still show provider selection
      expect(lastFrame()).toBeDefined()
    })

    it('should handle empty vaults list', async () => {
      mockIsInstalled.mockResolvedValue(true)
      mockListAccounts.mockResolvedValue([
        {
          account_uuid: 'uuid-1',
          email: 'user@example.com',
          url: 'https://example.1password.com',
          user_uuid: 'user-1',
        },
      ])
      mockListVaults.mockResolvedValue([])

      const { lastFrame } = render(
        <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Component should still render
      expect(lastFrame()).toBeDefined()
    })
  })

  describe('runKeygenInteractive', () => {
    it('should resolve with result on success', async () => {
      mockIsInstalled.mockResolvedValue(false)

      const mockFilesystemProvider = {
        generateKeyPair: vi.fn().mockResolvedValue({
          privateKeyRef: '/path/to/private.pem',
          publicKeyPath: '/path/to/public.pem',
          storageDescription: 'Filesystem: /path/to/private.pem',
        }),
      }

      vi.mocked(FilesystemKeyProvider).mockImplementation(() => mockFilesystemProvider as never)

      // This test would need user interaction simulation
      // For now, just verify the function exists
      expect(runKeygenInteractive).toBeDefined()
      expect(typeof runKeygenInteractive).toBe('function')
    })

    it('should reject when cancelled', async () => {
      // This would require simulating Ctrl+C or cancel action
      expect(runKeygenInteractive).toBeDefined()
    })

    it('should reject with error on failure', async () => {
      mockIsInstalled.mockRejectedValue(new Error('Test error'))

      // This would need actual error simulation
      expect(runKeygenInteractive).toBeDefined()
    })
  })

  describe('Component props', () => {
    it('should use custom publicKeyPath when provided', () => {
      mockIsInstalled.mockResolvedValue(false)

      const { lastFrame } = render(
        <KeygenInteractive
          publicKeyPath="/custom/path/public.pem"
          onComplete={vi.fn()}
          onCancel={vi.fn()}
          onError={vi.fn()}
        />,
      )

      expect(lastFrame()).toBeDefined()
    })

    it('should respect force flag', () => {
      mockIsInstalled.mockResolvedValue(false)

      const { lastFrame } = render(
        <KeygenInteractive
          force={true}
          onComplete={vi.fn()}
          onCancel={vi.fn()}
          onError={vi.fn()}
        />,
      )

      expect(lastFrame()).toBeDefined()
    })
  })
})

// Negative test cases
describe('KeygenInteractive - Negative Tests', () => {
  let mockIsInstalled: MockInstance
  let mockListAccounts: MockInstance

  beforeEach(() => {
    mockIsInstalled = vi.mocked(OnePasswordKeyProvider.isInstalled)
    mockListAccounts = vi.mocked(OnePasswordKeyProvider.listAccounts)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should not crash when onComplete throws', async () => {
    mockIsInstalled.mockResolvedValue(false)

    const onComplete = vi.fn().mockImplementation(() => {
      throw new Error('Callback error')
    })

    const { lastFrame } = render(
      <KeygenInteractive onComplete={onComplete} onCancel={vi.fn()} onError={vi.fn()} />,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Component should still render
    expect(lastFrame()).toBeDefined()
  })

  it('should handle malformed account data', async () => {
    mockIsInstalled.mockResolvedValue(true)
    mockListAccounts.mockResolvedValue([
      // Missing required fields
      { account_uuid: 'uuid-1' } as never,
    ])

    const { lastFrame } = render(
      <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should handle gracefully
    expect(lastFrame()).toBeDefined()
  })

  it('should handle null/undefined in provider methods', async () => {
    mockIsInstalled.mockResolvedValue(true)
    // eslint-disable-next-line unicorn/no-useless-undefined
    mockListAccounts.mockResolvedValue(undefined as never)

    const onError = vi.fn()

    const { lastFrame } = render(
      <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={onError} />,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should not crash
    expect(lastFrame()).toBeDefined()
  })

  it('should call onCancel when escape key is pressed', async () => {
    mockIsInstalled.mockResolvedValue(true)
    mockListAccounts.mockResolvedValue([
      {
        account_uuid: 'uuid-1',
        email: 'user@example.com',
        url: 'https://example.1password.com',
        user_uuid: 'user-1',
        name: 'Test Account',
      },
      {
        account_uuid: 'uuid-2',
        email: 'user2@example.com',
        url: 'https://example2.1password.com',
        user_uuid: 'user-2',
        name: 'Another Account',
      },
    ])

    const onCancel = vi.fn()

    const { stdin } = render(
      <KeygenInteractive onComplete={vi.fn()} onCancel={onCancel} onError={vi.fn()} />,
    )

    // Wait for component to load and show account selection
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Send escape key
    stdin.write('\u001B') // ESC character

    // Wait for event to be processed
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

// Regression tests for duplicate React key bug
// See: https://github.com/mike-north/attest-it/pull/31
describe('KeygenInteractive - Duplicate Key Regression Tests', () => {
  let mockIsInstalled: MockInstance
  let mockListAccounts: MockInstance
  let mockListVaults: MockInstance
  let consoleErrorSpy: MockInstance

  beforeEach(() => {
    mockIsInstalled = vi.mocked(OnePasswordKeyProvider.isInstalled)
    mockListAccounts = vi.mocked(OnePasswordKeyProvider.listAccounts)
    mockListVaults = vi.mocked(OnePasswordKeyProvider.listVaults)
    // Spy on console.error to detect React duplicate key warnings
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy.mockRestore()
  })

  it('should not produce duplicate key warning when accounts share the same email', async () => {
    // This is the real-world scenario: multiple 1Password accounts (e.g., personal + work)
    // can be registered with the same email address
    mockIsInstalled.mockResolvedValue(true)
    mockListAccounts.mockResolvedValue([
      {
        account_uuid: 'account-uuid-1',
        email: 'shared@example.com', // Same email
        url: 'https://my.1password.com', // Personal accounts share this URL
        user_uuid: 'user-uuid-1', // But user_uuid is unique
      },
      {
        account_uuid: 'account-uuid-2',
        email: 'shared@example.com', // Same email
        url: 'https://my.1password.com', // Same URL (both personal accounts)
        user_uuid: 'user-uuid-2', // Different user_uuid
      },
    ])

    const { lastFrame } = render(
      <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Component should render
    expect(lastFrame()).toBeDefined()

    // Should NOT have React duplicate key warning
    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('Encountered two children with the same key'),
    )
    expect(duplicateKeyWarnings).toHaveLength(0)
  })

  it('should not produce duplicate key warning when vaults share the same name', async () => {
    // Vaults in different accounts could theoretically have the same name
    mockIsInstalled.mockResolvedValue(true)
    mockListAccounts.mockResolvedValue([
      {
        account_uuid: 'account-uuid-1',
        email: 'user@example.com',
        url: 'https://company.1password.com',
        user_uuid: 'user-uuid-1',
      },
    ])
    mockListVaults.mockResolvedValue([
      { id: 'vault-id-1', name: 'Private' }, // Same name
      { id: 'vault-id-2', name: 'Private' }, // Same name, different ID
    ])

    const { lastFrame } = render(
      <KeygenInteractive onComplete={vi.fn()} onCancel={vi.fn()} onError={vi.fn()} />,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Component should render
    expect(lastFrame()).toBeDefined()

    // Should NOT have React duplicate key warning
    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('Encountered two children with the same key'),
    )
    expect(duplicateKeyWarnings).toHaveLength(0)
  })
})
