const { expect } = require("chai");

const envLib = require("../../scripts/lib/env");

const { createBesuLocalRpcUrlResolver } = envLib;
const canonicalEnvName = "BESU_LOCAL_RPC_URL";
const deprecatedEnvName = ["BESU", "RPC", "URL"].join("_");
const deprecationWarningName = ["BESU", "RPC", "URL", "DEPRECATION", "WARNING"].join("_");

describe("scripts/lib/env", function () {
    it("prefers BESU_LOCAL_RPC_URL over the deprecated RPC env var", function () {
        const warnings = [];
        const getBesuLocalRpcUrl = createBesuLocalRpcUrlResolver({
            env: {
                [canonicalEnvName]: "http://canonical.example:8545",
                [deprecatedEnvName]: "http://deprecated.example:8545",
            },
            warn: (message) => warnings.push(message),
        });

        expect(getBesuLocalRpcUrl()).to.equal("http://canonical.example:8545");
        expect(warnings).to.deep.equal([]);
    });

    it("falls back to the deprecated RPC env var with one deprecation warning", function () {
        const warnings = [];
        const getBesuLocalRpcUrl = createBesuLocalRpcUrlResolver({
            env: {
                [deprecatedEnvName]: "http://deprecated.example:8545",
            },
            warn: (message) => warnings.push(message),
        });

        expect(getBesuLocalRpcUrl()).to.equal("http://deprecated.example:8545");
        expect(getBesuLocalRpcUrl()).to.equal("http://deprecated.example:8545");
        expect(warnings).to.deep.equal([envLib[deprecationWarningName]]);
    });

    it("uses the local Besu default when neither RPC env var is set", function () {
        const getBesuLocalRpcUrl = createBesuLocalRpcUrlResolver({
            env: {},
            warn: () => {
                throw new Error("unexpected warning");
            },
        });

        expect(getBesuLocalRpcUrl()).to.equal("http://127.0.0.1:8545");
    });
});
