#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

./scripts/eslint.sh
./node_modules/.bin/imploder --tsconfig tsconfig.json