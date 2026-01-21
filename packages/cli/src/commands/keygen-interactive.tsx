/**
 * Interactive keygen UI component using Ink.
 *
 * @remarks
 * This module provides an interactive CLI interface for generating keypairs
 * with multiple storage options for private keys:
 * - Local filesystem
 * - macOS Keychain
 * - 1Password
 * - YubiKey (hardware security key with HMAC challenge-response)
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react'
import { render, Box, Text } from 'ink'
import { Select, TextInput, Spinner } from '@inkjs/ui'
import {
  OnePasswordKeyProvider,
  FilesystemKeyProvider,
  MacOSKeychainKeyProvider,
  YubiKeyProvider,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  getDefaultYubiKeyEncryptedKeyPath,
  type OnePasswordAccount,
  type OnePasswordVault,
  type YubiKeyInfo,
} from '@attest-it/core'

/**
 * Result of the interactive keygen flow.
 * @public
 */
export interface KeygenResult {
  /** Provider type used */
  provider: 'filesystem' | '1password' | 'macos-keychain' | 'yubikey'
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
  /** For 1Password/macOS Keychain: item name */
  itemName?: string
  /** For YubiKey: slot number */
  slot?: 1 | 2
  /** For YubiKey: device serial number */
  serial?: string
  /** For YubiKey: path to encrypted key file */
  encryptedKeyPath?: string
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
  | 'checking-providers'
  | 'select-provider'
  | 'select-account'
  | 'select-vault'
  | 'enter-item-name'
  | 'enter-keychain-item-name'
  | 'select-yubikey-device'
  | 'select-yubikey-slot'
  | 'yubikey-offer-setup'
  | 'yubikey-configuring'
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
  const [step, setStep] = useState<Step>('checking-providers')
  const [opAvailable, setOpAvailable] = useState(false)
  const [keychainAvailable, setKeychainAvailable] = useState(false)
  const [yubiKeyAvailable, setYubiKeyAvailable] = useState(false)
  const [accounts, setAccounts] = useState<OnePasswordAccount[]>([])
  const [vaults, setVaults] = useState<OnePasswordVault[]>([])
  const [yubiKeyDevices, setYubiKeyDevices] = useState<YubiKeyInfo[]>([])
  const [_selectedProvider, setSelectedProvider] = useState<
    'filesystem' | '1password' | 'macos-keychain' | 'yubikey' | undefined
  >()
  const [selectedAccount, setSelectedAccount] = useState<string | undefined>()
  const [selectedVault, setSelectedVault] = useState<string | undefined>()
  const [itemName, setItemName] = useState('attest-it-private-key')
  const [keychainItemName, setKeychainItemName] = useState('attest-it-private-key')
  const [selectedYubiKeySerial, setSelectedYubiKeySerial] = useState<string | undefined>()
  const [selectedYubiKeySlot, setSelectedYubiKeySlot] = useState<1 | 2>(2)
  const [slot1Configured, setSlot1Configured] = useState(false)
  const [slot2Configured, setSlot2Configured] = useState(false)

  // Check provider availability on mount
  useEffect(() => {
    const checkProviders = async (): Promise<void> => {
      // Check 1Password
      try {
        const isInstalled = await OnePasswordKeyProvider.isInstalled()
        setOpAvailable(isInstalled)

        if (isInstalled) {
          const accountList = await OnePasswordKeyProvider.listAccounts()
          setAccounts(accountList)
        }
      } catch {
        // 1Password not available
        setOpAvailable(false)
      }

      // Check macOS Keychain (synchronous check)
      const isKeychainAvailable = MacOSKeychainKeyProvider.isAvailable()
      setKeychainAvailable(isKeychainAvailable)

      // Check YubiKey
      try {
        const isInstalled = await YubiKeyProvider.isInstalled()
        if (isInstalled) {
          const isConnected = await YubiKeyProvider.isConnected()
          if (isConnected) {
            const devices = await YubiKeyProvider.listDevices()
            setYubiKeyDevices(devices)
            setYubiKeyAvailable(devices.length > 0)
          }
        }
      } catch {
        // YubiKey not available
        setYubiKeyAvailable(false)
      }

      setStep('select-provider')
    }

    void checkProviders()
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

  // Helper to check YubiKey slot configuration
  const checkYubiKeySlots = async (serial?: string): Promise<void> => {
    try {
      const slot1 = await YubiKeyProvider.isChallengeResponseConfigured(1, serial)
      const slot2 = await YubiKeyProvider.isChallengeResponseConfigured(2, serial)

      setSlot1Configured(slot1)
      setSlot2Configured(slot2)

      if (slot1 && slot2) {
        // Both configured - prompt user to choose
        setStep('select-yubikey-slot')
      } else if (slot2) {
        // Only slot 2 - auto-select
        setSelectedYubiKeySlot(2)
        void generateKeys('yubikey')
      } else if (slot1) {
        // Only slot 1 - auto-select
        setSelectedYubiKeySlot(1)
        void generateKeys('yubikey')
      } else {
        // Neither configured - offer to set up slot 2
        setStep('yubikey-offer-setup')
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error('Failed to check YubiKey slots'))
    }
  }

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
    } else if (value === 'macos-keychain') {
      setSelectedProvider('macos-keychain')
      // Move to item name entry for keychain
      setStep('enter-keychain-item-name')
    } else if (value === 'yubikey') {
      setSelectedProvider('yubikey')
      // If multiple devices, show device selection
      if (yubiKeyDevices.length > 1) {
        setStep('select-yubikey-device')
      } else if (yubiKeyDevices.length === 1 && yubiKeyDevices[0]) {
        // Single device - auto-select and check slots
        setSelectedYubiKeySerial(yubiKeyDevices[0].serial)
        void checkYubiKeySlots(yubiKeyDevices[0].serial)
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

  // Handle item name submission (1Password)
  const handleItemNameSubmit = (value: string): void => {
    setItemName(value)
    void generateKeys('1password')
  }

  // Handle keychain item name submission
  const handleKeychainItemNameSubmit = (value: string): void => {
    setKeychainItemName(value)
    void generateKeys('macos-keychain')
  }

  // Handle YubiKey device selection
  const handleYubiKeyDeviceSelect = (value: string): void => {
    setSelectedYubiKeySerial(value)
    void checkYubiKeySlots(value)
  }

  // Handle YubiKey slot selection
  const handleYubiKeySlotSelect = (value: string): void => {
    const slot = value === '1' ? 1 : 2
    setSelectedYubiKeySlot(slot)
    void generateKeys('yubikey')
  }

  // Handle YubiKey setup confirmation
  const handleYubiKeySetupConfirm = (value: string): void => {
    if (value === 'yes') {
      void setupYubiKeySlot()
    } else {
      onError(new Error('YubiKey setup cancelled'))
    }
  }

  // Setup YubiKey slot for challenge-response
  const setupYubiKeySlot = async (): Promise<void> => {
    setStep('yubikey-configuring')
    try {
      const { spawn } = await import('node:child_process')
      const args = ['otp', 'chalresp', '--touch', '--generate', '2']
      if (selectedYubiKeySerial) {
        args.unshift('--device', selectedYubiKeySerial)
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ykman', args, { stdio: 'inherit' })
        proc.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`ykman exited with code ${String(code)}`))
          }
        })
        proc.on('error', reject)
      })

      // After successful setup, use slot 2
      setSelectedYubiKeySlot(2)
      void generateKeys('yubikey')
    } catch (err) {
      onError(err instanceof Error ? err : new Error('Failed to configure YubiKey'))
    }
  }

  // Generate the keypair
  const generateKeys = async (
    provider: 'filesystem' | '1password' | 'macos-keychain' | 'yubikey',
  ): Promise<void> => {
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
      } else if (provider === '1password') {
        // 1Password provider
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
      } else if (provider === 'macos-keychain') {
        // macOS Keychain provider
        if (!keychainItemName) {
          throw new Error('Item name is required for macOS Keychain')
        }

        const keychainProvider = new MacOSKeychainKeyProvider({
          itemName: keychainItemName,
        })

        // Build generation options, only including force if defined
        const genOptions: { publicKeyPath: string; force?: boolean } = { publicKeyPath }
        if (props.force !== undefined) {
          genOptions.force = props.force
        }

        const result = await keychainProvider.generateKeyPair(genOptions)

        onComplete({
          provider: 'macos-keychain',
          publicKeyPath: result.publicKeyPath,
          privateKeyRef: result.privateKeyRef,
          storageDescription: result.storageDescription,
          itemName: keychainItemName,
        })
      } else {
        // YubiKey provider (provider === 'yubikey')
        const encryptedKeyPath = getDefaultYubiKeyEncryptedKeyPath()

        // Build provider options, only including serial if defined
        const providerOptions: { encryptedKeyPath: string; slot: 1 | 2; serial?: string } = {
          encryptedKeyPath,
          slot: selectedYubiKeySlot,
        }
        if (selectedYubiKeySerial !== undefined) {
          providerOptions.serial = selectedYubiKeySerial
        }

        const ykProvider = new YubiKeyProvider(providerOptions)

        // Build generation options, only including force if defined
        const genOptions: { publicKeyPath: string; force?: boolean } = { publicKeyPath }
        if (props.force !== undefined) {
          genOptions.force = props.force
        }

        const result = await ykProvider.generateKeyPair(genOptions)

        // Build completion result, only including serial if defined
        const completionResult: KeygenResult = {
          provider: 'yubikey',
          publicKeyPath: result.publicKeyPath,
          privateKeyRef: result.privateKeyRef,
          storageDescription: result.storageDescription,
          slot: selectedYubiKeySlot,
          encryptedKeyPath,
        }
        if (selectedYubiKeySerial !== undefined) {
          completionResult.serial = selectedYubiKeySerial
        }

        onComplete(completionResult)
      }

      setStep('done')
    } catch (err) {
      onError(err instanceof Error ? err : new Error('Key generation failed'))
    }
  }

  // Render different steps
  if (step === 'checking-providers') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text>Checking available key storage providers...</Text>
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

    if (keychainAvailable) {
      options.push({
        label: 'macOS Keychain',
        value: 'macos-keychain',
      })
    }

    if (yubiKeyAvailable) {
      options.push({
        label: 'YubiKey (hardware security key)',
        value: 'yubikey',
      })
    }

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

  if (step === 'enter-keychain-item-name') {
    return (
      <Box flexDirection="column">
        <Text bold>Enter name for the keychain item:</Text>
        <Text dimColor>(This will be the service name in your macOS Keychain)</Text>
        <Text dimColor>{''}</Text>
        <TextInput defaultValue={keychainItemName} onSubmit={handleKeychainItemNameSubmit} />
      </Box>
    )
  }

  if (step === 'select-yubikey-device') {
    const options = yubiKeyDevices.map((device) => ({
      label: `${device.type} (Serial: ${device.serial})`,
      value: device.serial,
    }))

    return (
      <Box flexDirection="column">
        <Text bold>Select YubiKey device:</Text>
        <Text dimColor>{''}</Text>
        <Select options={options} onChange={handleYubiKeyDeviceSelect} />
      </Box>
    )
  }

  if (step === 'select-yubikey-slot') {
    const options = []

    if (slot2Configured) {
      options.push({
        label: 'Slot 2 (recommended)',
        value: '2',
      })
    }

    if (slot1Configured) {
      options.push({
        label: 'Slot 1',
        value: '1',
      })
    }

    return (
      <Box flexDirection="column">
        <Text bold>Select YubiKey slot for challenge-response:</Text>
        <Text dimColor>{''}</Text>
        <Select options={options} onChange={handleYubiKeySlotSelect} />
      </Box>
    )
  }

  if (step === 'yubikey-offer-setup') {
    return (
      <Box flexDirection="column">
        <Text bold>Your YubiKey is not configured for challenge-response.</Text>
        <Text dimColor>{''}</Text>
        <Text>Would you like to configure slot 2 for challenge-response now?</Text>
        <Text dimColor>This will enable touch-to-sign functionality.</Text>
        <Text dimColor>{''}</Text>
        <Select
          options={[
            { label: 'Yes, configure my YubiKey', value: 'yes' },
            { label: 'No, cancel', value: 'no' },
          ]}
          onChange={handleYubiKeySetupConfirm}
        />
      </Box>
    )
  }

  if (step === 'yubikey-configuring') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text>Configuring YubiKey slot 2 for challenge-response...</Text>
        </Box>
        <Text dimColor>Touch your YubiKey when it flashes.</Text>
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
