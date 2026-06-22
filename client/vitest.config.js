// Scope vitest to the fast unit tests only. The e2e suite (test/suite/*.e2e
// .test.js) runs on node:test inside the VS Code extension host (require('vscode')
// is unavailable here), so it must NOT be picked up by vitest's default glob.
module.exports = {
    test: {
        include: ['test/unit/**/*.test.js'],
    },
};
