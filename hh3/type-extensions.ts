/* eslint-disable @typescript-eslint/no-explicit-any */
import 'hardhat/types/config';
import type {
  Address,
  DeploymentsExtension,
  DeterministicDeploymentInfo,
} from '../types.js';
import { DeploymentsManager } from './internal/DeploymentsManager.js';

declare module 'hardhat/types/config' {
  interface HardhatUserConfig {
    namedAccounts?: {
      [name: string]:
        | string
        | number
        | {[network: string]: null | number | string};
    };
    deterministicDeployment?:
      | {
          [network: string]: DeterministicDeploymentInfo;
        }
      | ((network: string) => DeterministicDeploymentInfo | undefined);
    external?: {
      deployments?: {
        [networkName: string]: string[];
      };
      contracts?: {
        artifacts: string | string[];
        deploy?: string;
      }[];
    };
    verify?: {etherscan?: {apiKey?: string}};
  }

  interface HardhatConfig {
    namedAccounts: {
      [name: string]:
        | string
        | number
        | {[network: string]: null | number | string};
    };
    deterministicDeployment?:
      | {
          [network: string]: DeterministicDeploymentInfo;
        }
      | ((network: string) => DeterministicDeploymentInfo | undefined);
    external?: {
      deployments?: {
        [networkName: string]: string[];
      };
      contracts?: {
        artifacts: string[];
        deploy?: string;
      }[];
    };
    verify: {etherscan?: {apiKey?: string}};
  }

  interface EdrNetworkUserConfig {
    live?: boolean;
    saveDeployments?: boolean;
    tags?: string[];
    deploy?: string | string[];
    verify?: {etherscan?: {apiKey?: string; apiUrl?: string}};
    zksync?: boolean;
    autoImpersonate?: boolean;
  }

  interface HttpNetworkUserConfig {
    live?: boolean;
    saveDeployments?: boolean;
    tags?: string[];
    deploy?: string | string[];
    verify?: {etherscan?: {apiKey?: string; apiUrl?: string}};
    zksync?: boolean;
    autoImpersonate?: boolean;
  }

  interface ProjectPathsUserConfig {
    deploy?: string | string[];
    deployments?: string;
    imports?: string;
  }

  interface EdrNetworkConfig {
    live: boolean;
    saveDeployments: boolean;
    tags: string[];
    deploy?: string[];
    verify?: {etherscan?: {apiKey?: string; apiUrl?: string}};
    zksync?: boolean;
    autoImpersonate?: boolean;
  }

  interface HttpNetworkConfig {
    live: boolean;
    saveDeployments: boolean;
    tags: string[];
    deploy?: string[];
    verify?: {etherscan?: {apiKey?: string; apiUrl?: string}};
    zksync?: boolean;
    autoImpersonate?: boolean;
  }

  interface ProjectPathsConfig {
    deploy: string[];
    deployments: string;
    imports: string;
  }
}

declare module 'hardhat/types/network' {
  interface NetworkConnection<
    ChainTypeT extends ChainType | string = DefaultChainType
  > {
    live: boolean;
    saveDeployments: boolean;
    tags: Record<string, boolean>;
    deploy: string[];
    verify?: {etherscan?: {apiKey?: string; apiUrl?: string}};
    zksync?: boolean;
    autoImpersonate?: boolean;
    deploymentsManager: DeploymentsManager<ChainTypeT>;
    deployments: DeploymentsExtension;
    getNamedAccounts: () => Promise<{
      [name: string]: Address;
    }>;
    getUnnamedAccounts: () => Promise<string[]>;
    getChainId(): Promise<string>;
  }
}
