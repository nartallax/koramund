#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

./node_modules/.bin/imploder --tsconfig tsconfig.json