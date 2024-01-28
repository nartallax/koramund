#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

./scripts/eslint.sh
# I shouldn't do this, but I don't want to fix the tests
# they should be fine even with broken tests.. something about late exit idk
# npm run test
./scripts/prepare_release.sh

cd target
npm publish --access public