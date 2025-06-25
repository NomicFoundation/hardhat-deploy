import type {
  ConfigurationVariableResolver,
  HardhatConfig,
  HardhatUserConfig,
} from "hardhat/types/config";
import type { ConfigHooks } from "hardhat/types/hooks";

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

  let deployPaths: HardhatConfig['paths']['deploy'] = [];
  if (userConfig.paths?.deploy) {
    deployPaths = (typeof userConfig.paths.deploy === 'string' ? [userConfig.paths.deploy] : userConfig.paths.deploy)
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
  
  const verifyConfig: HardhatConfig['verify'] = {};
  if (userConfig.verify?.etherscan?.apiKey !== undefined) {
    verifyConfig.etherscan = {
      apiKey: resolveConfigurationVariable(userConfig.verify.etherscan.apiKey),
    };
  }

  // backward compatibility for runtime (js)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((userConfig as any).etherscan) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verifyConfig.etherscan = (userConfig as any).etherscan;
  }

  return {
    ...resolvedConfig,
    namedAccounts: userConfig.namedAccounts ?? {},
    deterministicDeployment: userConfig.deterministicDeployment,
    external: resolveExternalConfig(userConfig, resolvedConfig),
    verify: verifyConfig,
    networks: resolveNetworksConfig(userConfig, resolvedConfig, resolveConfigurationVariable),
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

function resolveNetworksConfig(
  userConfig: HardhatUserConfig,
  config: HardhatConfig,
  resolveConfigurationVariable: ConfigurationVariableResolver
): HardhatConfig["networks"] {
  if (userConfig.networks === undefined) {
    return {};
  }
  
  const networks: HardhatConfig["networks"] = {};

  for (const [networkName, userNetwork] of Object.entries(userConfig.networks)) {
    const verifyConfig: HardhatConfig['networks'][string]['verify'] = {};
      if (userNetwork.verify?.etherscan?.apiKey !== undefined) {
        verifyConfig.etherscan = {
          apiKey: resolveConfigurationVariable(userNetwork.verify.etherscan.apiKey),
          apiUrl: userNetwork.verify.etherscan.apiUrl !== undefined
            ? resolveConfigurationVariable(userNetwork.verify.etherscan.apiUrl)
            : undefined,
        };
      }
      
      networks[networkName] = {
        ...config.networks[networkName],
        live: userNetwork.live ?? !/(localhost|hardhat)/.test(networkName),
        saveDeployments: userNetwork.saveDeployments ?? true,
        tags: userNetwork.tags ?? [],
        deploy: userNetwork.deploy !== undefined 
          ? typeof userNetwork.deploy === 'string' 
            ? [userNetwork.deploy] 
            : userNetwork.deploy 
          : config.paths.deploy,
        verify: verifyConfig,
        zksync: userNetwork.zksync,
        autoImpersonate: userNetwork.autoImpersonate ?? networkName === "hardhat",
      };
  }

  return networks;
}

function resolveExternalConfig(userConfig: HardhatUserConfig, config: HardhatConfig): HardhatConfig["external"] {
  if (userConfig.external === undefined) {
    return {}
  }

  const result: HardhatConfig["external"] = {};

  if (userConfig.external.contracts) {
    result.contracts = userConfig.external.contracts.map((userDefinedExternalContracts) => {
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

  if (userConfig.external.deployments) {
    result.deployments = {};
    for (const key of Object.keys(userConfig.external.deployments)) {
      result.deployments[key] = normalizePathArray(
        config,
        userConfig.external.deployments[key]
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
