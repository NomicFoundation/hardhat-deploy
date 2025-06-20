import './type-extensions';
import path from 'path';
import fs from 'fs-extra';
import murmur128 from 'murmur-128';
import {
  HardhatRuntimeEnvironment,
  HardhatConfig,
  HardhatUserConfig,
  EthereumProvider,
  Artifact,
  BuildInfo,
  NetworkConfig,
} from 'hardhat/types';
import {createProvider} from 'hardhat/internal/core/providers/construction'; // TODO harhdat argument types not from internal
import {LazyInitializationProviderAdapter} from "hardhat/internal/core/providers/lazy-initialization";
import {Deployment, ExtendedArtifact} from '../types.js';
import {extendEnvironment, task, subtask, extendConfig} from 'hardhat/config';
import {HARDHAT_NETWORK_NAME, HardhatPluginError} from 'hardhat/plugins';
import * as types from 'hardhat/internal/core/params/argumentTypes'; // TODO harhdat argument types not from internal
import {
  TASK_NODE,
  TASK_TEST,
  TASK_NODE_GET_PROVIDER,
  TASK_NODE_SERVER_READY,
} from 'hardhat/builtin-tasks/task-names';
import {lazyObject} from 'hardhat/plugins';

import debug from 'debug';
const log = debug('hardhat:wighawag:hardhat-deploy');

import {DeploymentsManager} from './DeploymentsManager.js';
import chokidar from 'chokidar';
import {submitSources} from './etherscan.js';
import {submitSourcesToSourcify} from './sourcify.js';
import {Network} from 'hardhat/types/runtime';
import {store} from './globalStore.js';
import {getDeployPaths, getNetworkName} from './utils.js';

export {getNetworkName};

export const TASK_DEPLOY = 'deploy';
export const TASK_DEPLOY_MAIN = 'deploy:main';
export const TASK_DEPLOY_RUN_DEPLOY = 'deploy:runDeploy';
export const TASK_EXPORT = 'export';
export const TASK_ETHERSCAN_VERIFY = 'etherscan-verify';
export const TASK_SOURCIFY = 'sourcify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodeTaskArgs: Record<string, any> = {};

function isHardhatEVM(hre: HardhatRuntimeEnvironment): boolean {
  const {network} = hre;
  return network.name === HARDHAT_NETWORK_NAME;
}

function normalizePath(
  config: HardhatConfig,
  userPath: string | undefined,
  defaultPath: string
): string {
  if (userPath === undefined) {
    userPath = path.join(config.paths.root, defaultPath);
  } else {
    if (!path.isAbsolute(userPath)) {
      userPath = path.normalize(path.join(config.paths.root, userPath));
    }
  }
  return userPath;
}

function createNetworkFromConfig(
  env: HardhatRuntimeEnvironment,
  networkName: string,
  config: NetworkConfig
): Network {
  const tags: {[tag: string]: boolean} = {};
  const tagsCollected = config.tags || [];
  for (const tag of tagsCollected) {
    tags[tag] = true;
  }

  const network = {
    name: networkName,
    config,
    live: config.live,
    saveDeployments: config.saveDeployments,
    zksync: config.zksync,
    tags,
    deploy: config.deploy || env.config.paths.deploy,
    companionNetworks: {},
  };
  networkFromConfig(env, network as Network, false);
  return network as Network;
}

log('start...');
let deploymentsManager: DeploymentsManager;
extendEnvironment((env) => {
  if (deploymentsManager === undefined || env.deployments === undefined) {
    deploymentsManager = new DeploymentsManager(
      env,
      lazyObject(() => env.network) // IMPORTANT, else other plugin cannot set env.network before end, like solidity-coverage does here in the coverage task :  https://github.com/sc-forks/solidity-coverage/blob/3c0f3a5c7db26e82974873bbf61cf462072a7c6d/plugins/resources/nomiclabs.utils.js#L93-L98
    );
    env.deployments = deploymentsManager.deploymentsExtension;
    env.getNamedAccounts =
      deploymentsManager.getNamedAccounts.bind(deploymentsManager);
    env.getUnnamedAccounts =
      deploymentsManager.getUnnamedAccounts.bind(deploymentsManager);
    env.getChainId = () => {
      return deploymentsManager.getChainId();
    };

    for (const networkName of Object.keys(env.config.networks)) {
      const config = env.config.networks[networkName];
      if (!('url' in config) || networkName === 'hardhat') {
        continue;
      }
      store.networks[networkName] = createNetworkFromConfig(
        env,
        networkName,
        config
      );
    }
  }
  initCompanionNetworks(env);
  log('ready');
});


function initCompanionNetworks(hre: HardhatRuntimeEnvironment) {
  hre.companionNetworks = {};
  for (const name of Object.keys(hre.network.companionNetworks)) {
    const networkName = hre.network.companionNetworks[name];
    // TODO Fork case ?
    if (networkName === hre.network.name) {
      deploymentsManager.addCompanionManager(name, deploymentsManager);
      const extraNetwork = {
        deployments: deploymentsManager.deploymentsExtension,
        getNamedAccounts: () => deploymentsManager.getNamedAccounts(),
        getUnnamedAccounts: () => deploymentsManager.getUnnamedAccounts(),
        getChainId: () => deploymentsManager.getChainId(),
        provider: lazyObject(() => hre.network.provider),
      };
      hre.companionNetworks[name] = extraNetwork;
      continue;
    }
    const config = hre.config.networks[networkName];
    if (!('url' in config) || networkName === 'hardhat') {
      throw new Error(
        `in memory network like hardhat are not supported as companion network`
      );
    }

    const network = store.networks[networkName];
    if (!network) {
      throw new Error(`no network named ${networkName}`);
    }

    network.provider = new LazyInitializationProviderAdapter(() => {
        return createProvider(
          hre.config,
          networkName,
          hre.artifacts
        );
    })

    const networkDeploymentsManager = new DeploymentsManager(hre, network);
    deploymentsManager.addCompanionManager(name, networkDeploymentsManager);
    const extraNetwork = {
      deployments: networkDeploymentsManager.deploymentsExtension,
      getNamedAccounts: () => networkDeploymentsManager.getNamedAccounts(),
      getUnnamedAccounts: () => networkDeploymentsManager.getUnnamedAccounts(),
      getChainId: () => networkDeploymentsManager.getChainId(),
      provider: network.provider,
    };
    hre.companionNetworks[name] = extraNetwork;
  }
}

subtask(TASK_DEPLOY_RUN_DEPLOY, 'deploy run only')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string
  )
  .addFlag(
    'tagsRequireAll',
    'execute only deploy scripts containing all the tags specified'
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    true,
    types.boolean
  )
  .addOptionalParam(
    'pendingtx',
    'whether to save pending tx',
    false,
    types.boolean
  )
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string
  )
  .addFlag('reset', 'whether to delete deployments files first')
  .addFlag('log', 'whether to output log')
  .addFlag('reportGas', 'report gas use')
  .setAction(async (args, hre) => {
    let tags = args.tags;
    if (typeof tags === 'string') {
      tags = tags.split(',');
    }
    await deploymentsManager.runDeploy(tags, {
      log: args.log,
      resetMemory: false,
      deletePreviousDeployments: args.reset,
      writeDeploymentsToFiles: args.write,
      export: args.export || process.env.HARDHAT_DEPLOY_EXPORT,
      exportAll: args.exportAll || process.env.HARDHAT_DEPLOY_EXPORT_ALL,
      savePendingTx: args.pendingtx,
      gasPrice: args.gasprice,
      maxFeePerGas: args.maxfee,
      maxPriorityFeePerGas: args.priorityfee,
      tagsRequireAll: args.tagsRequireAll,
    });
    if (args.reportGas) {
      console.log(`total gas used: ${hre.deployments.getGasUsed()}`);
    }
  });

subtask(TASK_DEPLOY_MAIN, 'deploy')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string
  )
  .addFlag(
    'tagsRequireAll',
    'execute only deploy scripts containing all the tags specified'
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    true,
    types.boolean
  )
  .addOptionalParam(
    'pendingtx',
    'whether to save pending tx',
    false,
    types.boolean
  )
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string
  )
  .addFlag('noCompile', 'disable pre compilation')
  .addFlag('reset', 'whether to delete deployments files first')
  .addFlag('log', 'whether to output log')
  .addFlag('watch', 'redeploy on every change of contract or deploy script')
  .addFlag(
    'watchOnly',
    'do not actually deploy, just watch and deploy if changes occurs'
  )
  .addFlag('reportGas', 'report gas use')
  .setAction(async (args, hre) => {
    if (args.reset) {
      await deploymentsManager.deletePreviousDeployments(
        args.runAsNode ? 'localhost' : undefined
      );
    }

    async function compileAndDeploy() {
      if (!args.noCompile) {
        await hre.run('compile');
      }
      return hre.run(TASK_DEPLOY_RUN_DEPLOY, {...args, reset: false});
    }

    let currentPromise: Promise<{
      [name: string]: Deployment;
    }> | null = args.watchOnly ? null : compileAndDeploy();
    if (args.watch || args.watchOnly) {
      const deployPaths = getDeployPaths(hre.network);
      const watcher = chokidar.watch(
        [hre.config.paths.sources, ...deployPaths],
        {
          ignored: /(^|[/\\])\../, // ignore dotfiles
          persistent: true,
        }
      );

      watcher.on('ready', () =>
        console.log('Initial scan complete. Ready for changes')
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rejectPending: any = null;
      // eslint-disable-next-line no-inner-declarations,@typescript-eslint/no-explicit-any
      function pending(): Promise<void> {
        return new Promise((resolve, reject) => {
          rejectPending = reject;
          if (currentPromise) {
            currentPromise
              .then(() => {
                rejectPending = null;
                resolve();
              })
              .catch((error) => {
                rejectPending = null;
                currentPromise = null;
                console.error(error);
              });
          } else {
            rejectPending = null;
            resolve();
          }
        });
      }
      watcher.on('change', async () => {
        console.log('change detected');
        if (currentPromise) {
          console.log('deployment in progress, please wait ...');
          if (rejectPending) {
            // console.log("disabling previously pending redeployments...");
            rejectPending();
          }
          try {
            // console.log("waiting for current redeployment...");
            await pending();
            // console.log("pending finished");
          } catch (e) {
            return;
          }
        }
        currentPromise = compileAndDeploy();
        try {
          await currentPromise;
        } catch (e) {
          console.error(e);
        }
        currentPromise = null;
      });
      try {
        await currentPromise;
      } catch (e) {
        console.error(e);
      }
      currentPromise = null;
      await new Promise((resolve) => setTimeout(resolve, 2000000000)); // TODO better way ?
    } else {
      const firstDeployments = await currentPromise;
      return firstDeployments;
    }
  });

task(TASK_TEST, 'Runs mocha tests')
  .addFlag('deployFixture', 'run the global fixture before tests')
  .addFlag('noImpersonation', 'do not impersonate unknown accounts')
  .setAction(async (args, hre, runSuper) => {
    if (args.noImpersonation) {
      deploymentsManager.disableAutomaticImpersonation();
    }
    if (args.deployFixture || process.env.HARDHAT_DEPLOY_FIXTURE) {
      if (!args.noCompile) {
        await hre.run('compile');
      }
      await hre.deployments.fixture(undefined, {
        keepExistingDeployments: true, // by default reuse the existing deployments (useful for fork testing)
      });
      return runSuper({...args, noCompile: true});
    } else {
      return runSuper(args);
    }
  });

task(TASK_DEPLOY, 'Deploy contracts')
  .setAction(async (args, hre) => {
    if (args.noImpersonation) {
      deploymentsManager.disableAutomaticImpersonation();
    }
    if (args.deployScripts) {
      // TODO support commas separated list
      hre.network.deploy = [
        normalizePath(hre.config, args.deployScripts, args.deployScripts),
      ];
      if (store.networks[getNetworkName(hre.network)]) {
        store.networks[getNetworkName(hre.network)].deploy = hre.network.deploy; // fallback to global store
      }
    }
    args.log = !args.silent;
    delete args.silent;
    if (args.write === undefined) {
      args.write = !isHardhatEVM(hre);
    }
    args.pendingtx = !isHardhatEVM(hre);
    await hre.run(TASK_DEPLOY_MAIN, args);
  });

task(
  TASK_EXPORT,
  'export contract deployment of the specified network into one file'
)
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .setAction(async (args) => {
    await deploymentsManager.loadDeployments(false);
    await deploymentsManager.export({
      export: args.export || process.env.HARDHAT_DEPLOY_EXPORT,
      exportAll: args.exportAll || process.env.HARDHAT_DEPLOY_EXPORT_ALL,
    });
  });

async function enableProviderLogging(
  provider: EthereumProvider,
  enabled: boolean
) {
  await provider.request({
    method: 'hardhat_setLoggingEnabled',
    params: [enabled],
  });
}

task(TASK_NODE, 'Starts a JSON-RPC server on top of Hardhat EVM')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    true,
    types.boolean
  )
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string
  )
  // TODO --unlock-accounts
  .addFlag('noReset', 'do not delete deployments files already present')
  .addFlag('noImpersonation', 'do not impersonate unknown accounts')
  .addFlag('silent', 'whether to renove log')
  .addFlag('noDeploy', 'do not deploy')
  .addFlag('watch', 'redeploy on every change of contract or deploy script')
  .setAction(async (args, hre, runSuper) => {
    if (args.noImpersonation) {
      deploymentsManager.disableAutomaticImpersonation();
    }
    nodeTaskArgs = args;
    if (!isHardhatEVM(hre)) {
      throw new HardhatPluginError(
        `
Unsupported network for JSON-RPC server. Only hardhat is currently supported.
hardhat-deploy cannot run on the hardhat provider when defaultNetwork is not hardhat, see https://github.com/nomiclabs/hardhat/issues/1139 and https://github.com/wighawag/hardhat-deploy/issues/63
you can specify hardhat via "--network hardhat"
`
      );
    }

    deploymentsManager.runAsNode(true);

    // console.log('node', args);
    await runSuper(args);
  });

subtask(TASK_NODE_GET_PROVIDER).setAction(
  async (args, hre, runSuper): Promise<EthereumProvider> => {
    const provider = await runSuper(args);

    if (!nodeTaskArgs.noReset) {
      await deploymentsManager.deletePreviousDeployments('localhost');
    }

    if (nodeTaskArgs.noDeploy) {
      // console.log('skip');
      return provider;
    }
    // console.log('enabling logging');
    await enableProviderLogging(provider, false);

    const networkName = getNetworkName(hre.network);
    if (networkName !== hre.network.name) {
      console.log(`copying ${networkName}'s deployment to localhost...`);
      // copy existing deployment from specified netwotk into localhost deployment folder
      await fs.copy(
        path.join(hre.config.paths.deployments, networkName),
        path.join(hre.config.paths.deployments, 'localhost')
      );
    }

    nodeTaskArgs.log = !nodeTaskArgs.silent;
    delete nodeTaskArgs.silent;
    nodeTaskArgs.pendingtx = false;
    await hre.run(TASK_DEPLOY_MAIN, {
      ...nodeTaskArgs,
      watch: false,
      reset: false,
    });

    await enableProviderLogging(provider, true);

    return provider;
  }
);

subtask(TASK_NODE_SERVER_READY).setAction(async (args, hre, runSuper) => {
  await runSuper(args);

  if (nodeTaskArgs.watch) {
    await hre.run(TASK_DEPLOY_MAIN, {
      ...nodeTaskArgs,
      watchOnly: true,
      reset: false,
    });
  }
});

task(TASK_ETHERSCAN_VERIFY, 'submit contract source code to etherscan')
  .addOptionalParam('apiKey', 'etherscan api key', undefined, types.string)
  .addOptionalParam(
    'license',
    'SPDX license (useful if SPDX is not listed in the sources), need to be supported by etherscan: https://etherscan.io/contract-license-types',
    undefined,
    types.string
  )
  .addOptionalParam(
    'apiUrl',
    'specify the url manually',
    undefined,
    types.string
  )
  .addOptionalParam(
    'contractName',
    'specific contract name to verify',
    undefined,
    types.string
  )
  .addFlag(
    'forceLicense',
    'force the use of the license specified by --license option'
  )
  .addFlag(
    'sleep',
    'sleep 500ms between each verification, so API rate limit is not exceeded'
  )
  .addFlag(
    'solcInput',
    'fallback on solc-input (useful when etherscan fails on the minimum sources, see https://github.com/ethereum/solidity/issues/9573)'
  )
  .addFlag(
    'writePostData',
    'write the post data on file in "etherscan_requests/<network>" folder, for debugging purpose'
  )
  .setAction(async (args, hre) => {
    const etherscanApiKey =
      args.apiKey ||
      process.env.ETHERSCAN_API_KEY ||
      hre.network.verify?.etherscan?.apiKey ||
      hre.config.verify?.etherscan?.apiKey;
    if (!etherscanApiKey) {
      throw new Error(
        `No Etherscan API KEY provided. Set it through command line option, in hardhat.config.ts, or by setting the "ETHERSCAN_API_KEY" env variable`
      );
    }
    const solcInputsPath = await deploymentsManager.getSolcInputPath();
    await submitSources(hre, solcInputsPath, {
      contractName: args.contractName,
      etherscanApiKey,
      license: args.license,
      fallbackOnSolcInput: args.solcInput,
      forceLicense: args.forceLicense,
      sleepBetween: args.sleep,
      apiUrl: args.apiUrl || hre.network.verify?.etherscan?.apiUrl,
      writePostData: args.writePostData,
    });
  });

task(
  TASK_SOURCIFY,
  'submit contract source code to sourcify (https://sourcify.dev)'
)
  .addOptionalParam(
    'endpoint',
    'endpoint url for sourcify',
    undefined,
    types.string
  )
  .addOptionalParam(
    'contractName',
    'specific contract name to verify',
    undefined,
    types.string
  )
  .addFlag(
    'writeFailingMetadata',
    'write to disk failing metadata for easy debugging'
  )
  .setAction(async (args, hre) => {
    await submitSourcesToSourcify(hre, args);
  });

task('export-artifacts')
  .addPositionalParam(
    'dest',
    'destination folder where the extended artifacts files will be written to',
    undefined,
    types.string
  )
  .addFlag(
    'solcInput',
    'if set, artifacts will have an associated solcInput files (required for old version of solidity to ensure verifiability'
  )
  .addFlag(
    'includingEmptyBytecode',
    'if set, even contract without bytecode (like interfaces) will be exported'
  )
  .addFlag(
    'includingNoPublicFunctions',
    'if set, even contract without public interface (like imternal libraries) will be exported'
  )
  .addOptionalParam(
    'exclude',
    'list of contract names separated by commas to exclude',
    undefined,
    types.string
  )
  .addOptionalParam(
    'include',
    'list of contract names separated by commas to include. If specified, only these will be considered',
    undefined,
    types.string
  )
  .addFlag(
    'hideSources',
    'if set, the artifacts files will not contain source code (metadata or other data exposing it) unless specified via --sources-for'
  )
  .addOptionalParam(
    'sourcesFor',
    'list of contract names separated by commas to include source (metadata,etc...) for (see --hide-sources)',
    undefined,
    types.string
  )
  .setAction(async (args, hre) => {
    await hre.run('compile');
    const argsInclude: string[] = args.include ? args.include.split(',') : [];
    const checkInclude = argsInclude.length > 0;
    const include = argsInclude.reduce(
      (result: Record<string, boolean>, item: string) => {
        result[item] = true;
        return result;
      },
      {}
    );
    const argsExclude: string[] = args.exclude ? args.exclude.split(',') : [];
    const exclude = argsExclude.reduce(
      (result: Record<string, boolean>, item: string) => {
        result[item] = true;
        return result;
      },
      {}
    );
    const argsSourcesFor: string[] = args.sourcesFor
      ? args.sourcesFor.split(',')
      : [];
    const sourcesFor = argsSourcesFor.reduce(
      (result: Record<string, boolean>, item: string) => {
        result[item] = true;
        return result;
      },
      {}
    );
    const extendedArtifactFolderpath = args.dest;
    fs.emptyDirSync(extendedArtifactFolderpath);
    const artifactPaths = await hre.artifacts.getArtifactPaths();
    for (const artifactPath of artifactPaths) {
      const artifact: Artifact = await fs.readJSON(artifactPath);
      const artifactName = path.basename(artifactPath, '.json');
      if (exclude[artifactName]) {
        continue;
      }
      if (checkInclude && !include[artifactName]) {
        continue;
      }
      const artifactDBGPath = path.join(
        path.dirname(artifactPath),
        artifactName + '.dbg.json'
      );
      const artifactDBG = await fs.readJSON(artifactDBGPath);
      const buildinfoPath = path.join(
        path.dirname(artifactDBGPath),
        artifactDBG.buildInfo
      );
      const buildInfo: BuildInfo = await fs.readJSON(buildinfoPath);
      const output =
        buildInfo.output.contracts[artifact.sourceName][artifactName];

      if (!args.includingNoPublicFunctions) {
        if (
          !artifact.abi ||
          artifact.abi.filter((v) => v.type !== 'event').length === 0
        ) {
          continue;
        }
      }

      if (!args.includingEmptyBytecode) {
        if (!artifact.bytecode || artifact.bytecode === '0x') {
          continue;
        }
      }

      // TODO decide on ExtendedArtifact vs Artifact vs Deployment type
      // save space by not duplicating bytecodes
      if (output.evm?.bytecode?.object) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (output.evm.bytecode.object as any) = undefined;
      }
      if (output.evm?.deployedBytecode?.object) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (output.evm.deployedBytecode.object as any) = undefined;
      }
      // -----------------------------------------

      const extendedArtifact: ExtendedArtifact = {
        ...artifact,
        ...output,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (extendedArtifact as any)._format = undefined;

      if (args.solcInput) {
        const solcInput = JSON.stringify(buildInfo.input, null, '  ');
        const solcInputHash = Buffer.from(murmur128(solcInput)).toString('hex');
        extendedArtifact.solcInput = solcInput;
        extendedArtifact.solcInputHash = solcInputHash;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let dataToWrite: any = extendedArtifact;
      if (args.hideSources && !sourcesFor[artifactName]) {
        dataToWrite = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contractName: (extendedArtifact as any).contractName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sourceName: (extendedArtifact as any).sourceName,
          abi: extendedArtifact.abi,
          bytecode: extendedArtifact.bytecode,
          deployedBytecode: extendedArtifact.deployedBytecode,
          linkReferences: extendedArtifact.linkReferences,
          deployedLinkReferences: extendedArtifact.deployedLinkReferences,
          devdoc: extendedArtifact.devdoc,
          userdoc: extendedArtifact.userdoc,
          evm: extendedArtifact.evm
            ? {
                gasEstimates: extendedArtifact.evm.gasEstimates,
                methodIdentifiers: extendedArtifact.evm.methodIdentifiers,
              }
            : undefined,
        };
      }

      let filepath = path.join(
        extendedArtifactFolderpath,
        artifactName + '.json'
      );
      if (dataToWrite.sourceName) {
        if (dataToWrite.contractName) {
          filepath = path.join(
            extendedArtifactFolderpath,
            dataToWrite.sourceName,
            dataToWrite.contractName + '.json'
          );
        } else {
          filepath = path.join(
            extendedArtifactFolderpath,
            dataToWrite.sourceName,
            artifactName + '.json'
          );
        }
      }

      fs.ensureFileSync(filepath);
      fs.writeFileSync(filepath, JSON.stringify(dataToWrite, null, '  '));
    }
  });
