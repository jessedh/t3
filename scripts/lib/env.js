const DEFAULT_BESU_LOCAL_RPC_URL = "http://127.0.0.1:8545";
const BESU_RPC_URL_DEPRECATION_WARNING =
    "Warning: BESU_RPC_URL is deprecated; use BESU_LOCAL_RPC_URL instead.";

function createBesuLocalRpcUrlResolver({ env = process.env, warn = console.warn } = {}) {
    let warnedDeprecatedBesuRpcUrl = false;

    return function getBesuLocalRpcUrl() {
        if (env.BESU_LOCAL_RPC_URL) {
            return env.BESU_LOCAL_RPC_URL;
        }

        if (env.BESU_RPC_URL) {
            if (!warnedDeprecatedBesuRpcUrl) {
                warn(BESU_RPC_URL_DEPRECATION_WARNING);
                warnedDeprecatedBesuRpcUrl = true;
            }
            return env.BESU_RPC_URL;
        }

        return DEFAULT_BESU_LOCAL_RPC_URL;
    };
}

const getBesuLocalRpcUrl = createBesuLocalRpcUrlResolver();

module.exports = {
    BESU_RPC_URL_DEPRECATION_WARNING,
    DEFAULT_BESU_LOCAL_RPC_URL,
    createBesuLocalRpcUrlResolver,
    getBesuLocalRpcUrl,
};
