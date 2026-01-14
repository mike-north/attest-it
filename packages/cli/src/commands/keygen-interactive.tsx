/**
 * Interactive keygen UI component using Ink.
 *
 * @remarks
 * This module provides an interactive CLI interface for generating keypairs
 * with the option to store private keys in either the filesystem or 1Password.
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react'
import { render, Box, Text } from 'ink'
import { Select, TextInput, Spinner } from '@inkjs/ui'
import {
  OnePasswordKeyProvider,
  FilesystemKeyProvider,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  type OnePasswordAccount,
  type OnePasswordVault,
} from '@attest-it/core'

/**
 * Result of the interactive keygen flow.
 * @public
 */
export interface KeygenResult {
  /** Provider type used */
  provider: 'filesystem' | '1password'
  /** Path to the public key file */
  publicKeyPath: string
  /** Reference to the private key (path or 1Password item name) */
  privateKeyRef: string
  /** Human-readable description of storage location */
  storageDescription: string
  /** For 1Password: account email */
  account?: string
  /** For 1Password: vault name */
  vault?: string
  /** For 1Password: item name */
  itemName?: string
}

/**
 * Props for the KeygenInteractive component.
 * @public
 */
export interface KeygenInteractiveProps {
  /** Public key path (optional, defaults to OS-specific path) */
  publicKeyPath?: string
  /** Overwrite existing keys without prompting */
  force?: boolean
  /** Callback when keygen completes successfully */
  onComplete: (result: KeygenResult) => void
  /** Callback when user cancels */
  onCancel: () => void
  /** Callback when an error occurs */
  onError: (error: Error) => void
}

/**
 * Step in the interactive keygen flow.
 * @internal
 */
type Step =
  | 'checking-1password'
  | 'select-provider'
  | 'select-account'
  | 'select-vault'
  | 'enter-item-name'
  | 'generating'
  | 'done'

/**
 * Interactive keygen component.
 *
 * @remarks
 * This component walks the user through selecting a key storage provider
 * and configuring it, then generates the keypair.
 *
 * @param props - Component props
 * @returns React element
 * @public
 */
export function KeygenInteractive(props: KeygenInteractiveProps): React.ReactElement {
  const { onComplete, onError } = props

  // State management
  const [step, setStep] = useState<Step>('checking-1password')
  const [opAvailable, setOpAvailable] = useState(false)
  const [accounts, setAccounts] = useState<OnePasswordAccount[]>([])
  const [vaults, setVaults] = useState<OnePasswordVault[]>([])
  const [_selectedProvider, setSelectedProvider] = useState<'filesystem' | '1password' | undefined>()
  const [selectedAccount, setSelectedAccount] = useState<string | undefined>()
  const [selectedVault, setSelectedVault] = useState<string | undefined>()
  const [itemName, setItemName] = useState('attest-it-private-key')

  // Check 1Password availability on mount
  useEffect(() => {
    const checkOnePassword = async (): Promise<void> => {
      try {
        const isInstalled = await OnePasswordKeyProvider.isInstalled()
        setOpAvailable(isInstalled)

        if (isInstalled) {
          const accountList = await OnePasswordKeyProvider.listAccounts()
          setAccounts(accountList)
        }
      } catch {
        // 1Password not available, continue with filesystem only
        setOpAvailable(false)
      }

      setStep('select-provider')
    }

    void checkOnePassword()
  }, [])

  // Fetch vaults when account is selected
  useEffect(() => {
    if (step === 'select-vault' && selectedAccount) {
      const fetchVaults = async (): Promise<void> => {
        try {
          const vaultList = await OnePasswordKeyProvider.listVaults(selectedAccount)
          setVaults(vaultList)
        } catch (err) {
          onError(err instanceof Error ? err : new Error('Failed to fetch vaults'))
        }
      }

      void fetchVaults()
    }
  }, [step, selectedAccount, onError])

  // Handle provider selection
  const handleProviderSelect = (value: string): void => {
    if (value === 'filesystem') {
      setSelectedProvider('filesystem')
      // Skip to generation for filesystem
      void generateKeys('filesystem')
    } else if (value === '1password') {
      setSelectedProvider('1password')
      // Move to account selection (or skip if only one)
      if (accounts.length === 1 && accounts[0]) {
        setSelectedAccount(accounts[0].email)
        setStep('select-vault')
      } else {
        setStep('select-account')
      }
    }
  }

  // Handle account selection
  const handleAccountSelect = (value: string): void => {
    setSelectedAccount(value)
    setStep('select-vault')
  }

  // Handle vault selection
  const handleVaultSelect = (value: string): void => {
    setSelectedVault(value)
    setStep('enter-item-name')
  }

  // Handle item name submission
  const handleItemNameSubmit = (value: string): void => {
    setItemName(value)
    void generateKeys('1password')
  }

  // Generate the keypair
  const generateKeys = async (provider: 'filesystem' | '1password'): Promise<void> => {
    setStep('generating')

    try {
      const publicKeyPath = props.publicKeyPath ?? getDefaultPublicKeyPath()

      if (provider === 'filesystem') {
        const fsProvider = new FilesystemKeyProvider()

        // Build options, only including force if defined
        const genOptions: { publicKeyPath: string; force?: boolean } = { publicKeyPath }
        if (props.force !== undefined) {
          genOptions.force = props.force
        }

        const result = await fsProvider.generateKeyPair(genOptions)

        onComplete({
          provider: 'filesystem',
          publicKeyPath: result.publicKeyPath,
          privateKeyRef: result.privateKeyRef,
          storageDescription: result.storageDescription,
        })
      } else {
        // Must be 1password at this point
        if (!selectedVault || !itemName) {
          throw new Error('Vault and item name are required for 1Password')
        }

        // Build provider options, only including account if defined
        const providerOptions: { vault: string; itemName: string; account?: string } = {
          vault: selectedVault,
          itemName,
        }
        if (selectedAccount !== undefined) {
          providerOptions.account = selectedAccount
        }

        const opProvider = new OnePasswordKeyProvider(providerOptions)

        // Build generation options, only including force if defined
        const genOptions: { publicKeyPath: string; force?: boolean } = { publicKeyPath }
        if (props.force !== undefined) {
          genOptions.force = props.force
        }

        const result = await opProvider.generateKeyPair(genOptions)

        // Build completion result, only including account if defined
        const completionResult: KeygenResult = {
          provider: '1password',
          publicKeyPath: result.publicKeyPath,
          privateKeyRef: result.privateKeyRef,
          storageDescription: result.storageDescription,
          vault: selectedVault,
          itemName,
        }
        if (selectedAccount !== undefined) {
          completionResult.account = selectedAccount
        }

        onComplete(completionResult)
      }

      setStep('done')
    } catch (err) {
      onError(err instanceof Error ? err : new Error('Key generation failed'))
    }
  }

  // Render different steps
  if (step === 'checking-1password') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text>Checking for 1Password CLI...</Text>
        </Box>
      </Box>
    )
  }

  if (step === 'select-provider') {
    const options = [
      {
        label: `Local Filesystem (${getDefaultPrivateKeyPath()})`,
        value: 'filesystem',
      },
    ]

    if (opAvailable) {
      options.push({
        label: '1Password (requires op CLI)',
        value: '1password',
      })
    }

    return (
      <Box flexDirection="column">
        <Text bold>Where would you like to store your private key?</Text>
        <Text dimColor>{''}</Text>
        <Select options={options} onChange={handleProviderSelect} />
      </Box>
    )
  }

  if (step === 'select-account') {
    const options = accounts.map((account) => ({
      label: account.email,
      value: account.email,
    }))

    return (
      <Box flexDirection="column">
        <Text bold>Select 1Password account:</Text>
        <Text dimColor>{''}</Text>
        <Select options={options} onChange={handleAccountSelect} />
      </Box>
    )
  }

  if (step === 'select-vault') {
    if (vaults.length === 0) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Spinner />
            <Text>Loading vaults...</Text>
          </Box>
        </Box>
      )
    }

    const options = vaults.map((vault) => ({
      label: vault.name,
      value: vault.name,
    }))

    return (
      <Box flexDirection="column">
        <Text bold>Select vault for private key storage:</Text>
        <Text dimColor>{''}</Text>
        <Select options={options} onChange={handleVaultSelect} />
      </Box>
    )
  }

  if (step === 'enter-item-name') {
    return (
      <Box flexDirection="column">
        <Text bold>Enter name for the key item:</Text>
        <Text dimColor>(This will be visible in your 1Password vault)</Text>
        <Text dimColor>{''}</Text>
        <TextInput defaultValue={itemName} onSubmit={handleItemNameSubmit} />
      </Box>
    )
  }

  if (step === 'generating') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text>Generating RSA-2048 keypair...</Text>
        </Box>
      </Box>
    )
  }

  // Done state (component will be unmounted by parent)
  return <Box />
}

/**
 * Run the interactive keygen flow.
 *
 * @remarks
 * This function renders the KeygenInteractive component and returns a promise
 * that resolves with the keygen result or rejects if cancelled/errored.
 *
 * @param options - Keygen options
 * @returns Promise that resolves with keygen result
 * @public
 */
export async function runKeygenInteractive(options: {
  publicKeyPath?: string
  force?: boolean
}): Promise<KeygenResult> {
  return new Promise((resolve, reject) => {
    // Build props, only including optional properties if defined
    const props: KeygenInteractiveProps = {
      onComplete: (result) => {
        unmount()
        resolve(result)
      },
      onCancel: () => {
        unmount()
        reject(new Error('Keygen cancelled'))
      },
      onError: (error) => {
        unmount()
        reject(error)
      },
    }

    if (options.publicKeyPath !== undefined) {
      props.publicKeyPath = options.publicKeyPath
    }
    if (options.force !== undefined) {
      props.force = options.force
    }

    const { unmount } = render(<KeygenInteractive {...props} />)
  })
}
