import type { HookContext, NetworkHooks } from "hardhat/types/hooks";
import type { ChainType, NetworkConnection } from "hardhat/types/network";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";

import { DeploymentsManager } from "../DeploymentsManager.js";


export default async (): Promise<Partial<NetworkHooks>> => ({
  newConnection,
});

export async function newConnection<ChainTypeT extends ChainType | string>(
  context: HookContext,
  next: (
    nextContext: HookContext,
  ) => Promise<NetworkConnection<ChainTypeT>>,
) {
  const connection: NetworkConnection<ChainTypeT> = await next(context);

  const networkConfig = context.config.networks[connection.networkName];

  connection.live = networkConfig.live ?? !/(localhost|hardhat)/.test(connection.networkName)
  connection.autoImpersonate = networkConfig.autoImpersonate ?? connection.networkName === "hardhat"

  connection.verify = networkConfig.verify?.etherscan 
    ? {
        etherscan: {
          apiKey: await networkConfig.verify.etherscan.apiKey?.get(),
          apiUrl: await networkConfig.verify.etherscan.apiUrl?.get(),
        },
      }
    : undefined;

  connection.zksync = networkConfig.zksync

  connection.tags = {};
  for (const tag of networkConfig.tags ?? []) {
    connection.tags[tag] = true;
  }

  connection.deploy = networkConfig.deploy ?? context.config.paths.deploy

  connection.saveDeployments = networkConfig.saveDeployments ?? true;

  const hre = await import("hardhat");

  // In the interest of getting the update out quickly, we are using an antipattern here.
  // For general practice, we highly recommend against importing the HRE inside a hook like this.
  connection.deploymentsManager = new DeploymentsManager(hre as unknown as HardhatRuntimeEnvironment & { }, connection);
  connection.deployments = connection.deploymentsManager.deploymentsExtension;

  connection.getNamedAccounts = connection.deploymentsManager.getNamedAccounts.bind(
    connection.deploymentsManager,
  );
  connection.getUnnamedAccounts = connection.deploymentsManager.getUnnamedAccounts.bind(
    connection.deploymentsManager,
  );
  connection.getChainId = () => {
    return connection.deploymentsManager.getChainId();
  }

  return connection;
}
