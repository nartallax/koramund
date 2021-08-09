#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

./scripts/eslint.sh
npm run test
./scripts/prepare_release.sh

cd target
npm publish --access public