const MAX_ITERATIONS = process.env.GOAP_MAX_ITERATIONS ? Number(process.env.GOAP_MAX_ITERATIONS) : 200
const YIELD_INTERVAL = process.env.GOAP_YIELD_INTERVAL ? Number(process.env.GOAP_YIELD_INTERVAL) : 50  // 50 → 25に短縮

module.exports = { MAX_ITERATIONS, YIELD_INTERVAL }
