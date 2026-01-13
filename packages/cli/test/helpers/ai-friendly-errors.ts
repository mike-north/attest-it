/**
 * Utilities for providing AI-friendly error messages when tests fail.
 *
 * These helpers wrap operations that might fail due to cryptographic signature
 * issues and provide clear messages to AI assistants that human intervention
 * is required.
 */

/**
 * Wraps an async operation and re-throws errors with AI-friendly messages
 * when signature-related issues are detected.
 *
 * @param operation - The async operation to execute
 * @param context - Description of what operation is being performed
 * @returns The result of the operation
 * @throws Enhanced error with AI-friendly message if signature issues detected
 */
export async function wrapWithSignatureErrorDetection<T>(
  operation: () => Promise<T>,
  context: string,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : ''

    // Detect signature-related errors
    const isSignatureError =
      errorMessage.includes('unable to load key') ||
      errorMessage.includes('Failed to sign') ||
      errorMessage.includes('signature verification failed') ||
      errorMessage.includes('invalid signature') ||
      errorMessage.includes('PEM routines') ||
      errorMessage.includes('no start line') ||
      errorMessage.includes('CRYPTO_internal') ||
      errorMessage.includes('attestations file may have been tampered')

    if (isSignatureError) {
      const aiMessage = [
        '',
        '════════════════════════════════════════════════════════════════',
        '⚠️  HUMAN INTERVENTION REQUIRED - CRYPTOGRAPHIC SIGNATURE ISSUE',
        '════════════════════════════════════════════════════════════════',
        '',
        'This test failed due to a CRYPTOGRAPHIC SIGNATURE issue that',
        'CANNOT be automatically fixed by AI assistants.',
        '',
        '⚠️  IMPORTANT: This restriction applies ONLY to signature-related',
        'errors. AI assistants should continue helping with all other types',
        'of test failures (logic bugs, assertions, setup issues, etc.).',
        '',
        'Signature-related failures typically indicate:',
        '  • Missing or corrupted private/public key files',
        '  • Signature verification failures (tampering detected)',
        '  • Expired attestation signatures',
        '  • Incorrect key file permissions or formats',
        '',
        'DO NOT ATTEMPT TO (for signature issues only):',
        '  ✗ Regenerate keys automatically',
        '  ✗ Modify signature validation logic',
        '  ✗ Bypass signature checks',
        '  ✗ Loop trying different approaches',
        '',
        'REQUIRED ACTION (for signature issues):',
        '  ✓ Ask a human to review the key setup',
        '  ✓ Verify key files exist in correct locations',
        '  ✓ Check file permissions on private key',
        '  ✓ Consider if this is expected test behavior',
        '',
        'CONTINUE NORMALLY for all other test failures!',
        '',
        '📖 AI Assistant Guide:',
        '   https://raw.githubusercontent.com/mike-north/attest-it/refs/heads/main/AI_ASSISTANT_GUIDE.md',
        '',
        `Context: ${context}`,
        '',
        'Original error:',
        `  ${errorMessage}`,
        '',
        '════════════════════════════════════════════════════════════════',
        '',
      ].join('\n')

      const enhancedError = new Error(aiMessage)
      enhancedError.stack = errorStack
      // Preserve original error as a property
      ;(enhancedError as any).originalError = error
      throw enhancedError
    }

    // Not a signature error, re-throw as-is
    throw error
  }
}

/**
 * Checks if an error is a signature-related error that requires human intervention.
 *
 * @param error - The error to check
 * @returns True if the error is signature-related
 */
export function isSignatureRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('HUMAN INTERVENTION REQUIRED') ||
    message.includes('unable to load key') ||
    message.includes('signature verification failed') ||
    message.includes('invalid signature')
  )
}
