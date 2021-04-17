#!/bin/bash

set -e
cd `dirname "$0"`
cd ..

npm run compile
npm run test

PKGDIR=`mktemp -d -p .`
function cleanup {
	rm -rf "$PKGDIR"
	echo "Deleted temp working directory $PKGDIR"
}
trap cleanup EXIT
cd $PKGDIR

cp ../README.md ./
cp ../LICENSE ./
cp ../package.json ./package.json

echo "#!/usr/bin/env node" > koramund.js 
cat ../js/bundle.js >> koramund.js
chmod 744 koramund.js

npm publish --access public
cd ..