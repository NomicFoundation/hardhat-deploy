import type { HardhatPlugin } from "hardhat/types/plugins";

import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

import { PLUGIN_ID } from "./internal/constants.js";

import "./type-extensions.js";

const hardhatDeployPlugin: HardhatPlugin = {
  id: PLUGIN_ID,
  npmPackage: "hardhat-deploy",
  hookHandlers: {
    config: import.meta.resolve("./internal/hook-handlers/config.js"),
    network: import.meta.resolve("./internal/hook-handlers/network.js"),
  },
  dependencies: [
    async () => {
      const { default: ethersPlugin } = await import(
        "@nomicfoundation/hardhat-ethers"
      );

      return ethersPlugin;
    },
  ],
  tasks: [
    task(["deploy"], "Deploy contracts")
      .addOption({
        name: "export",
        description: "export current network deployments",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "exportAll",
        description: "export all network deployments into one file",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "tags",
        description: "specify which deploy script to execute via tags, separated by commas",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "gasprice",
        description: "gas price to use for transactions",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "maxfee",
        description: "max fee per gas",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "priorityfee",
        description: "max priority fee per gas",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addOption({
        name: "deployScripts",
        description: "override deploy script folder path",
        type: ArgumentType.STRING_WITHOUT_DEFAULT,
        defaultValue: undefined,
      })
      .addFlag({
        name: "tagsRequireAll",
        description: "execute only deploy scripts containing all the tags specified",
      })
      .addFlag({
        name: "write",
        description: "whether to write deployments to file",
      })
      .addFlag({
        name: "noImpersonation",
        description: "do not impersonate unknown accounts",
      })
      .addFlag({
        name: "noCompile",
        description: "disable pre compilation",
      })
      .addFlag({
        name: "reset",
        description: "whether to delete deployments files first",
      })
      .addFlag({
        name: "silent",
        description: "whether to remove log",
      })
      .addFlag({
        name: "watch",
        description: "redeploy on every change of contract or deploy script",
      })
      .addFlag({
        name: "reportGas",
        description: "report gas use",
      })
      .setAction(import.meta.resolve("./internal/tasks/deploy.js"))
      .build(),
  ]
}

export default hardhatDeployPlugin;
