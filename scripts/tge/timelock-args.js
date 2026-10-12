/**
 * SLTimelock 소스 검증용 생성자 인자 (deployments/<network>.timelock.json 에서 읽음)
 *
 *   HH_NETWORK=opbnbTestnet npx hardhat verify --network opbnbTestnet --constructor-args scripts/tge/timelock-args.js <timelock 주소>
 */
const net = process.env.HH_NETWORK || "opbnbTestnet";
const j = require(`../../deployments/${net}.timelock.json`);
module.exports = [j.minDelay, j.proposers, j.executors, "0x0000000000000000000000000000000000000000"];
