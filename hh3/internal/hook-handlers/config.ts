import type {
  ConfigurationVariableResolver,
  HardhatConfig,
  HardhatUserConfig,
} from "hardhat/types/config";
import type { ConfigHooks } from "hardhat/types/hooks";

import path from "path";
import { normalizePath, normalizePathArray } from "../utils.js";

export default async (): Promise<Partial<ConfigHooks>> => ({
  resolveUserConfig,
});

export async function resolveUserConfig(
  userConfig: HardhatUserConfig,
  resolveConfigurationVariable: ConfigurationVariableResolver,
  next: (
    nextUserConfig: HardhatUserConfig,
    nextResolveConfigurationVariable: ConfigurationVariableResolver,
  ) => Promise<HardhatConfig>,
): Promise<HardhatConfig> {
  const resolvedConfig = await next(userConfig, resolveConfigurationVariable);
  const paths = resolvedConfig.paths ?? {};

  let deployPaths: string[] = [];
  if (paths.deploy) {
    deployPaths = (typeof paths.deploy === 'string' ? [paths.deploy] : paths.deploy)
      .map((p) => normalizePath(resolvedConfig, p, 'deploy'));
  } else {
    deployPaths = [normalizePath(resolvedConfig, undefined, 'deploy')];
  }

  for (const profileName of Object.keys(resolvedConfig.solidity?.profiles)) {
    for (const compiler of resolvedConfig.solidity.profiles[profileName].compilers) {
      if (compiler.settings !== undefined) {
        setupExtraSolcSettings(compiler.settings);
      }
    }
  }
  
  const verifyConfig = resolvedConfig.verify ?? {};
  // backward compatibility for runtime (js)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((resolvedConfig as any).etherscan) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verifyConfig.etherscan = (userConfig as any).etherscan;
  }

  return {
    ...resolvedConfig,
    namedAccounts: userConfig.namedAccounts ?? {},
    external: resolveExternalConfig(resolvedConfig),
    verify: verifyConfig,
    paths: {
      ...paths,
      deployments: normalizePath(
        resolvedConfig,
        userConfig.paths?.deployments,
        'deployments'
      ),
      imports: normalizePath(
        resolvedConfig,
        userConfig.paths?.imports,
        'imports'
      ),
      deploy: deployPaths,
    }
  }
}

function resolveExternalConfig(config: HardhatConfig): HardhatConfig["external"] | undefined {
  if (config.external === undefined) {
    return
  }

  const result: HardhatConfig["external"] = {};

  if (config.external.contracts) {
    result.contracts = config.external.contracts.map((userDefinedExternalContracts) => {
      const userArtifacts =
            typeof userDefinedExternalContracts.artifacts === 'string'
              ? [userDefinedExternalContracts.artifacts]
              : userDefinedExternalContracts.artifacts;

      return {
        artifacts: userArtifacts.map((a) => normalizePath(config, a, a)),
        deploy: userDefinedExternalContracts.deploy
              ? normalizePath(
                  config,
                  userDefinedExternalContracts.deploy,
                  userDefinedExternalContracts.deploy
                )
              : undefined,
      }
    })
  }

  if (config.external.deployments) {
    result.deployments = {};
    for (const key of Object.keys(config.external.deployments)) {
      result.deployments[key] = normalizePathArray(
        config,
        config.external.deployments[key]
      );
    }
  }

  return result;
}

function addIfNotPresent(array: string[], value: string) {
  if (array.indexOf(value) === -1) {
    array.push(value);
  }
}

function setupExtraSolcSettings(settings: {
  metadata: {useLiteralContent: boolean};
  outputSelection: {'*': {'': string[]; '*': string[]}};
}): void {
  settings.metadata = settings.metadata || {};
  settings.metadata.useLiteralContent = true;

  if (settings.outputSelection === undefined) {
    settings.outputSelection = {
      '*': {
        '*': [],
        '': [],
      },
    };
  }
  if (settings.outputSelection['*'] === undefined) {
    settings.outputSelection['*'] = {
      '*': [],
      '': [],
    };
  }
  if (settings.outputSelection['*']['*'] === undefined) {
    settings.outputSelection['*']['*'] = [];
  }
  if (settings.outputSelection['*'][''] === undefined) {
    settings.outputSelection['*'][''] = [];
  }

  addIfNotPresent(settings.outputSelection['*']['*'], 'abi');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.bytecode');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.deployedBytecode');
  addIfNotPresent(settings.outputSelection['*']['*'], 'metadata');
  addIfNotPresent(settings.outputSelection['*']['*'], 'devdoc');
  addIfNotPresent(settings.outputSelection['*']['*'], 'userdoc');
  addIfNotPresent(settings.outputSelection['*']['*'], 'storageLayout');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.methodIdentifiers');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.gasEstimates');
  // addIfNotPresent(settings.outputSelection["*"][""], "ir");
  // addIfNotPresent(settings.outputSelection["*"][""], "irOptimized");
  // addIfNotPresent(settings.outputSelection["*"][""], "ast");
}
