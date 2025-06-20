import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { NewTaskActionFunction } from "hardhat/types/tasks";
import { normalizePath } from "../utils.js";

async function isHardhatEVM(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const connection = await hre.network.connect()
  return connection.networkName === "hardhat";
}

interface TaskDeployArguments {
  export?: string;
  exportAll?: string;
  tags?: string | string[];
  tagsRequireAll?: boolean;
  gasprice?: string;
  maxfee?: string;
  priorityfee?: string;
  deployScripts?: string;
  write: boolean;
  noImpersonation: boolean;
  noCompile: boolean;
  reset: boolean;
  silent: boolean;
  watch: boolean;
  reportGas: boolean;
}

const taskDeploy: NewTaskActionFunction<TaskDeployArguments> = async ({
  export: exportFlag,
  exportAll,
  tags,
  tagsRequireAll,
  write,
  gasprice,
  maxfee,
  priorityfee,
  deployScripts,
  noImpersonation,
  noCompile,
  reset,
  silent,
},
hre: HardhatRuntimeEnvironment) => {
  const connection = await hre.network.connect();

  if (noImpersonation) {
    connection.deploymentsManager.disableAutomaticImpersonation();
  }

  if (deployScripts) {
    connection.deploy = [
      normalizePath(hre.config, deployScripts, deployScripts),
    ];

    // if (store.networks[getNetworkName(hre.network)]) {
    //   store.networks[getNetworkName(hre.network)].deploy = hre.network.deploy; // fallback to global store
    // }
  }

  if (write === undefined) {
    write = !isHardhatEVM(hre);
  }

  const pendingtx = !isHardhatEVM(hre);

  if (reset) {
    await connection.deploymentsManager.deletePreviousDeployments();
  }

  if (!noCompile) {
    await hre.tasks.getTask("compile").run()
  }

  await connection.deploymentsManager.runDeploy(typeof tags === "string" ? tags.split(",") : tags, {
    tagsRequireAll,
    log: !silent,
    resetMemory: false,
    deletePreviousDeployments: reset,
    writeDeploymentsToFiles: write,
    export: exportFlag || process.env.HARDHAT_DEPLOY_EXPORT,
    exportAll: exportAll || process.env.HARDHAT_DEPLOY_EXPORT_ALL,
    savePendingTx: pendingtx,
    gasPrice: gasprice,
    maxFeePerGas: maxfee,
    maxPriorityFeePerGas: priorityfee,
  })

  // if (reportGas) {
  //   console.log(`total gas used: ${hre.deployments.getGasUsed()}`);
  // }
}

export default taskDeploy;
