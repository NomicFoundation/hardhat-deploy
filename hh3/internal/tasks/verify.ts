import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { NewTaskActionFunction } from "hardhat/types/tasks";

import axios from "axios";
import chalk from 'chalk';
import fs from 'fs-extra'
import { createRequire } from "module";
import path from "path";
import qs from "qs";
import { ParamType, AbiCoder } from "ethers";

function log(...args: any[]) {
  console.log(...args);
}

function logError(...args: any[]) {
  console.log(chalk.red(...args));
}

function logInfo(...args: any[]) {
  console.log(chalk.yellow(...args));
}

function logSuccess(...args: any[]) {
  console.log(chalk.green(...args));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOneLicenseFromSourceFile(source: string): string | undefined {
  const licenses = extractLicenseFromSources(source);
  if (licenses.length === 0) {
    return undefined;
  }
  return licenses[0]; // TODO error out on multiple SPDX ?
}

function extractLicenseFromSources(metadata: string): string[] {
  const require = createRequire(import.meta.url);
  const matchAll = require('match-all');

  const regex = /\/\/\s*\t*SPDX-License-Identifier:\s*\t*(.*?)[\s\\]/g;
  const matches = matchAll(metadata, regex).toArray();
  const licensesFound: {[license: string]: boolean} = {};
  const licenses = [];
  if (matches) {
    for (const match of matches) {
      if (!licensesFound[match]) {
        licensesFound[match] = true;
        licenses.push(match);
      }
    }
  }
  return licenses;
}


function getLicenseType(license: string): undefined | number {
  switch (license) {
    case 'None':
      return 1;
    case 'UNLICENSED':
      return 2;
    case 'MIT':
      return 3;
    case 'GPL-2.0':
      return 4;
    case 'GPL-3.0':
      return 5;
    case 'LGPL-2.1':
      return 6;
    case 'LGPL-3.0':
      return 7;
    case 'BSD-2-Clause':
      return 8;
    case 'BSD-3-Clause':
      return 9;
    case 'MPL-2.0':
      return 10;
    case 'OSL-3.0':
      return 11;
    case 'Apache-2.0':
      return 12;
    case 'AGPL-3.0':
      return 13;
    case 'BUSL-1.1':
      return 14;
    default:
      return undefined; // unsupported license
  }
}

function writeRequestIfRequested(
  write: boolean,
  networkName: string,
  name: string,
  request: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  postData: any
) {
  if (write) {
    try {
      fs.mkdirSync('etherscan_requests');
    } catch (e) {}
    const folder = `etherscan_requests/${networkName}`;
    try {
      fs.mkdirSync(folder);
    } catch (e) {}
    fs.writeFileSync(`${folder}/${name}.formdata`, request);
    fs.writeFileSync(`${folder}/${name}.json`, JSON.stringify(postData));
    fs.writeFileSync(
      `${folder}/${name}_multi-source.json`,
      postData.sourceCode
    );
  }
}

function resolveApiUrl(apiUrl: string | undefined, chainId: string): string {
  if (apiUrl) {
    return apiUrl;
  }
  
  switch (chainId) {
    case '1':
      return 'https://api.etherscan.io';
    case '3':
      return 'https://api-ropsten.etherscan.io';
    case '4':
      return 'https://api-rinkeby.etherscan.io';
    case '5':
      return 'https://api-goerli.etherscan.io';
    case '10':
      return 'https://api-optimistic.etherscan.io';
    case '42':
      return 'https://api-kovan.etherscan.io';
    case '97':
      return 'https://api-testnet.bscscan.com';
    case '56':
      return 'https://api.bscscan.com';
    case '69':
      return 'https://api-kovan-optimistic.etherscan.io';
    case '70':
      return 'https://api.hooscan.com';
    case '77':
      return 'https://blockscout.com/poa/sokol';
    case '128':
      return 'https://api.hecoinfo.com';
    case '137':
      return 'https://api.polygonscan.com';
    case '250':
      return 'https://api.ftmscan.com';
    case '256':
      return 'https://api-testnet.hecoinfo.com';
    case '420':
      return 'https://api-goerli-optimism.etherscan.io';
    case '588':
      return 'https://stardust-explorer.metis.io';
    case '1088':
      return 'https://andromeda-explorer.metis.io';
    case '1284':
      return 'https://api-moonbeam.moonscan.io';
    case '1285':
      return 'https://api-moonriver.moonscan.io';
    case '80001':
      return 'https://api-testnet.polygonscan.com';
    case '4002':
      return 'https://api-testnet.ftmscan.com';
    case '42161':
      return 'https://api.arbiscan.io';
    case '421611':
      return 'https://api-testnet.arbiscan.io';
    case '421613':
      return 'https://api-goerli.arbiscan.io';
    case '43113':
      return 'https://api-testnet.snowtrace.io';
    case '43114':
      return 'https://api.snowtrace.io';
    case '338':
      return 'https://api-testnet.cronoscan.com/api';
    case '25':
      return 'https://api.cronoscan.com/api';
    case '11155111':
      return 'https://api-sepolia.etherscan.io';
    case '11155420':
      return 'https://api-sepolia-optimistic.etherscan.io';
    default:
      throw new Error(
        `Network with chainId: ${chainId} not supported. You can specify the url manually via --api-url <url>.`
      );
  }
}

interface TaskVerifyArguments {
  apiKey?: string;
  license?: string;
  apiUrl?: string;
  contractName?: string;
  forceLicense?: boolean;
  sleep?: boolean;
  solcInput?: boolean;
  writePostData?: boolean;
}

const taskVerify: NewTaskActionFunction<TaskVerifyArguments> = async ({
  apiKey,
  license,
  apiUrl: givenApiUrl,
  contractName,
  forceLicense,
  sleep: sleepBetween,
  solcInput: fallbackOnSolcInput,
  writePostData,
}, hre: HardhatRuntimeEnvironment) => {
  const connection = await hre.network.connect();

  const apiUrl = givenApiUrl || connection.verify?.etherscan?.apiUrl

  const etherscanApiKey = 
    apiKey ||
    process.env.ETHERSCAN_API_KEY ||
    connection.verify?.etherscan?.apiKey ||
    hre.config.verify?.etherscan?.apiKey;

  if (!etherscanApiKey) {
    throw new Error(
      `No Etherscan API KEY provided. Set it through command line option, in hardhat.config.ts, or by setting the "ETHERSCAN_API_KEY" env variable`
    );
  }

  const solcInputsPath = connection.deploymentsManager.getSolcInputPath();

  // submitSources function from v2 hardhat-deploy

  const all = await connection.deployments.all();
  const networkName = connection.networkName;
  const chainId = await connection.getChainId();
  const host = resolveApiUrl(apiUrl, chainId);

  async function submit(name: string, useSolcInput?: boolean) {
    const deployment = all[name];
    const { address, metadata: metadataString } = deployment;
    const abiResponse = await axios.get(
      `${host}/api?module=contract&action=getabi&address=${address}&apikey=${etherscanApiKey}`
    );
    const { data: abiData } = abiResponse;
    let contractABI;
    if (abiData.status !== '0') {
      try {
        contractABI = JSON.parse(abiData.result);
      } catch (e) {
        logError(e);
        return;
      }
    }

    if (contractABI && contractABI !== '') {
      log(`already verified: ${name} (${address}), skipping.`);
      return;
    }

    if (!metadataString) {
      logError(
        `Contract ${name} was deployed without saving metadata. Cannot submit to etherscan, skipping.`
      );
      return;
    }
    const metadata = JSON.parse(metadataString);
    const compilationTarget = metadata.settings?.compilationTarget;

    let contractFilepath;
    let contractName;
    if (compilationTarget) {
      contractFilepath = Object.keys(compilationTarget)[0];
      contractName = compilationTarget[contractFilepath];
    }

    if (!contractFilepath || !contractName) {
      return logError(
        `Failed to extract contract fully qualified name from metadata.settings.compilationTarget for ${name}. Skipping.`
      );
    }

    const contractNamePath = `${contractFilepath}:${contractName}`;

    const contractSourceFile = metadata.sources[contractFilepath].content;
    const sourceLicenseType =
      extractOneLicenseFromSourceFile(contractSourceFile);

    if (!sourceLicenseType) {
      if (!license) {
        return logError(
          `no license speccified in the source code for ${name} (${contractNamePath}), Please use option --license <SPDX>`
        );
      }
    } else {
      if (license && license !== sourceLicenseType) {
        if (!forceLicense) {
          return logError(
            `mismatch for --license option (${license}) and the one specified in the source code for ${name}.\nLicenses found in source : ${sourceLicenseType}\nYou can use option --force-license to force option --license`
          );
        }
      } else {
        license = sourceLicenseType;
        if (!getLicenseType(license)) {
          return logError(
            `license :"${license}" found in source code for ${name} (${contractNamePath}) but this license is not supported by etherscan, list of supported license can be found here : https://etherscan.io/contract-license-types . This tool expect the SPDX id, except for "None" and "UNLICENSED"`
          );
        }
      }
    }

    const licenseType = getLicenseType(license);

    if (!licenseType) {
      return logError(
        `license :"${license}" not supported by etherscan, list of supported license can be found here : https://etherscan.io/contract-license-types . This tool expect the SPDX id, except for "None" and "UNLICENSED"`
      );
    }

    let solcInput: {
      language: string;
      settings: any;
      sources: Record<string, {content: string}>;
    };
    if (useSolcInput) {
      const solcInputHash = deployment.solcInputHash;
      let solcInputStringFromDeployment: string | undefined;
      try {
        solcInputStringFromDeployment = fs
          .readFileSync(path.join(solcInputsPath, solcInputHash + '.json'))
          .toString();
      } catch (e) {}
      if (!solcInputStringFromDeployment) {
        logError(
          `Contract ${name} was deployed without saving solcInput. Cannot submit to etherscan, skipping.`
        );
        return;
      }
      solcInput = JSON.parse(solcInputStringFromDeployment);
    } else {
      const settings = {...metadata.settings};
      delete settings.compilationTarget;
      solcInput = {
        language: metadata.language,
        settings,
        sources: {},
      };
      for (const sourcePath of Object.keys(metadata.sources)) {
        const source = metadata.sources[sourcePath];
        // only content as this fails otherwise
        solcInput.sources[sourcePath] = {
          content: source.content,
        };
      }
    }

    // Adding Libraries ....
    if (deployment.libraries) {
      const settings = solcInput.settings;
      settings.libraries = settings.libraries || {};
      for (const libraryName of Object.keys(deployment.libraries)) {
        if (!settings.libraries[contractNamePath]) {
          settings.libraries[contractNamePath] = {};
        }
        settings.libraries[contractNamePath][libraryName] =
          deployment.libraries[libraryName];
      }
    }
    const solcInputString = JSON.stringify(solcInput);

    logInfo(`verifying ${name} (${address}) ...`);

    let constructorArguements: string | undefined;
    if (deployment.args) {
      const constructor: {inputs: ParamType[]} = deployment.abi.find(
        (v) => v.type === 'constructor'
      );
      if (constructor) {
        constructorArguements = AbiCoder.defaultAbiCoder()
          .encode(constructor.inputs, deployment.args)
          .slice(2);
      }
    } else {
      logInfo(`no args found, assuming empty constructor...`);
    }

    const apikey = typeof etherscanApiKey === 'string' || etherscanApiKey === undefined
      ? etherscanApiKey 
      : await etherscanApiKey.get()

    const postData: {
      [fieldName: string]: string | number | void | undefined; // TODO type
    } = {
      apikey,
      module: 'contract',
      action: 'verifysourcecode',
      contractaddress: address,
      sourceCode: solcInputString,
      codeformat: 'solidity-standard-json-input',
      contractname: contractNamePath,
      compilerversion: `v${metadata.compiler.version}`, // see http://etherscan.io/solcversions for list of support versions
      constructorArguements,
      licenseType,
    };

    const formDataAsString = qs.stringify(postData);
    const submissionResponse = await axios.request({
      url: `${host}/api`,
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      data: formDataAsString,
    });
    const {data: submissionData} = submissionResponse;

    let guid: string;
    if (submissionData.status === '1') {
      guid = submissionData.result;
    } else {
      logError(
        `contract ${name} failed to submit : "${submissionData.message}" : "${submissionData.result}"`,
        submissionData
      );
      writeRequestIfRequested(
        writePostData || false,
        networkName,
        name,
        formDataAsString,
        postData
      );
      return;
    }
    if (!guid) {
      logError(`contract submission for ${name} failed to return a guid`);
      writeRequestIfRequested(
        writePostData || false,
        networkName,
        name,
        formDataAsString,
        postData
      );
      return;
    }

    async function checkStatus(): Promise<string | undefined> {
      // TODO while loop and delay :
      const statusResponse = await axios.get(
        `${host}/api?apikey=${etherscanApiKey}`,
        {
          params: {
            guid,
            module: 'contract',
            action: 'checkverifystatus',
          },
        }
      );
      const {data: statusData} = statusResponse;

      // blockscout seems to return status == 1 in case of failure
      // so we check string first
      if (statusData.result === 'Pending in queue') {
        return undefined;
      }
      if (statusData.result !== 'Fail - Unable to verify') {
        if (statusData.status === '1') {
          // console.log(statusData);
          return 'success';
        }
      }
      logError(
        `Failed to verify contract ${name}: ${statusData.message}, ${statusData.result}`
      );

      logError(
        JSON.stringify(
          {
            apikey: 'XXXXXX',
            module: 'contract',
            action: 'verifysourcecode',
            contractaddress: address,
            sourceCode: '...',
            codeformat: 'solidity-standard-json-input',
            contractname: contractNamePath,
            compilerversion: `v${metadata.compiler.version}`, // see http://etherscan.io/solcversions for list of support versions
            constructorArguements,
            licenseType,
          },
          null,
          '  '
        )
      );
      // logError(JSON.stringify(postData, null, "  "));
      // logInfo(postData.sourceCode);
      return 'failure';
    }

    logInfo('waiting for result...');
    let result;
    while (!result) {
      await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
      result = await checkStatus();
    }

    if (result === 'success') {
      logSuccess(` => contract ${name} is now verified`);
    }

    if (result === 'failure') {
      if (!useSolcInput && fallbackOnSolcInput) {
        logInfo(
          'Falling back on solcInput. etherscan seems to sometime require full solc-input with all source files, even though this should not be needed. See https://github.com/ethereum/solidity/issues/9573'
        );
        await submit(name, true);
      } else {
        writeRequestIfRequested(
          writePostData || false,
          networkName,
          name,
          formDataAsString,
          postData
        );
        logInfo(
          'Etherscan sometime fails to verify when only metadata sources are given. See https://github.com/ethereum/solidity/issues/9573. You can add the option --solc-input to try with full solc-input sources. This will include all contract source in the etherscan result, even the one not relevant to the contract being verified'
        );
      }
    } else {
      writeRequestIfRequested(
        writePostData || false,
        networkName,
        name,
        formDataAsString,
        postData
      );
    }
  }

  if (contractName) {
    await submit(contractName);
  } else {
    for (const name of Object.keys(all)) {
      await submit(name);

      if (sleepBetween) {
        // sleep between each verification so we don't exceed the API rate limit
        await sleep(500);
      }
    }
  }
}

export default taskVerify;
