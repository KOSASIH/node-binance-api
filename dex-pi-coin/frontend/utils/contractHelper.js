import { ethers } from 'ethers';

export const getContractInstance = async (contractName, address, signerOrProvider) => {
  const abi = require(`../abis/${contractName}.json`);
  return new ethers.Contract(address, abi, signerOrProvider);
};
