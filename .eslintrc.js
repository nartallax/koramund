module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: [
		'@typescript-eslint',
	],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	rules: {
		"prefer-const": "off",

		// namespaces have their own uses, no need to disallow them completely
		"@typescript-eslint/no-namespace": "off",
	}
};