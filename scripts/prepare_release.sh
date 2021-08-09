#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

./scripts/eslint.sh

rm -rf ./target
./node_modules/.bin/imploder --tsconfig tsconfig.json
scripts/generate_dts.sh "ts/src/koramund.ts" "koramund.d.ts"
cp ./package.json ./target/
cp ./LICENSE ./target/
cp ./README.md ./target/