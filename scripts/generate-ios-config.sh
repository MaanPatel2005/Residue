#!/bin/bash
# Generate iOS build configuration from .env

if [ ! -f .env ]; then
    echo "Error: .env file not found"
    exit 1
fi

source .env

cat > ios/ResiduePhone/Config.xcconfig << XCCONFIG
// Auto-generated from .env - do not commit
RESIDUE_BASE_URL = $(RESIDUE_BASE_URL)
MELANGE_PERSONAL_KEY = $(MELANGE_PERSONAL_KEY)
MELANGE_DISTRACTION_MODEL_KEY = $(MELANGE_DISTRACTION_MODEL_KEY)
XCCONFIG

echo "✓ Generated Config.xcconfig"
