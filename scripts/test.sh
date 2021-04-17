#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

./node_modules/.bin/imploder --tsconfig tsconfig.tests.json
node js/test.js "$1"