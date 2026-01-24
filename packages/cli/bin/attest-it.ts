import { tryDelegateToLocal } from '../src/local-resolver.js'

// Try local resolution BEFORE any other initialization
// This ensures projects use their pinned version rather than a global installation
tryDelegateToLocal()

import { run } from '../src/index.js'

void run()
