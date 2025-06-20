import { concat, ContractFactory, getAddress, Overrides, Signer, solidityPackedKeccak256 } from 'ethers';
import { Artifact } from 'hardhat/types/artifacts';
import * as zk from 'zksync-ethers';
import { Address, Deployment, DeployOptions, ExtendedArtifact } from '../../types.js';
import { TransactionRequest } from 'ethers';
import { TransactionResponse } from 'ethers';
import { TransactionReceipt } from 'ethers';

export class DeploymentFactory {
  private factory: ContractFactory | zk.ContractFactory;
  private artifact: Artifact | ExtendedArtifact;
  private isZkSync: boolean;
  private getArtifact: (name: string) => Promise<Artifact>;
  private overrides: Overrides;
  private args: any[];
  constructor(
    getArtifact: (name: string) => Promise<Artifact>,
    artifact: Artifact | ExtendedArtifact,
    args: any[],
    network: any,
    ethersSigner?: Signer | zk.Signer,
    overrides: Overrides = {}
  ) {
    this.overrides = overrides;
    this.getArtifact = getArtifact;
    this.isZkSync = network.zksync;
    this.artifact = artifact;
    if (this.isZkSync) {
      this.factory = new zk.ContractFactory(
        artifact.abi,
        artifact.bytecode,
        ethersSigner as zk.Signer
      );
    } else {
      this.factory = new ContractFactory(
        artifact.abi,
        artifact.bytecode,
        ethersSigner as Signer
      );
    }
    const numArguments = this.factory.interface.deploy.inputs.length;
    if (args.length !== numArguments) {
      throw new Error(
        `expected ${numArguments} constructor arguments, got ${args.length}`
      );
    }
    this.args = args;
  }

  public async extractFactoryDeps(artifact: any): Promise<string[]> {
    const visited = new Set<string>();
    visited.add(`${artifact.sourceName}:${artifact.contractName}`);
    return await this._extractFactoryDepsRecursive(artifact, visited);
  }

  private async _extractFactoryDepsRecursive(
    artifact: any,
    visited: Set<string>
  ): Promise<string[]> {
    // Load all the dependency bytecodes.
    // We transform it into an array of bytecodes.
    const factoryDeps: string[] = [];
    for (const dependencyHash in artifact.factoryDeps) {
      if (!dependencyHash) continue;
      const dependencyContract = artifact.factoryDeps[dependencyHash];
      if (!visited.has(dependencyContract)) {
        const dependencyArtifact = await this.getArtifact(dependencyContract);
        factoryDeps.push(dependencyArtifact.bytecode);
        visited.add(dependencyContract);
        const transitiveDeps = await this._extractFactoryDepsRecursive(
          dependencyArtifact,
          visited
        );
        factoryDeps.push(...transitiveDeps);
      }
    }
    return factoryDeps;
  }

  public async getDeployTransaction(): Promise<TransactionRequest> {
    let overrides = this.overrides;
    if (this.isZkSync) {
      const factoryDeps = await this.extractFactoryDeps(this.artifact);

      const { customData, ..._overrides } = overrides ?? {};
      overrides = {
        ..._overrides,
        customData: {
            ...customData,
            factoryDeps,
            feeToken: zk.utils.ETH_ADDRESS,
        },
      };
    }

    return this.factory.getDeployTransaction(...this.args, overrides);
  }

  private async calculateEvmCreate2Address(
    create2DeployerAddress: Address,
    salt: string
  ): Promise<Address> {
    const deploymentTx = await this.getDeployTransaction();
    if (typeof deploymentTx.data !== 'string')
      throw Error('unsigned tx data as bytes not supported');
    return getAddress(
      '0x' +
      solidityPackedKeccak256(
        ['bytes'],
        [
          `0xff${create2DeployerAddress.slice(2)}${salt.slice(
            2
          )}${solidityPackedKeccak256(['bytes'], [deploymentTx.data]).slice(2)}`,
        ]
      ).slice(-40)
    );
  }

  private async calculateZkCreate2Address(
    create2DeployerAddress: Address,
    salt: string
  ): Promise<Address> {
    const bytecodeHash = zk.utils.hashBytecode(this.artifact.bytecode);
    const constructor = this.factory.interface.encodeDeploy(this.args);
    return zk.utils.create2Address(
      create2DeployerAddress,
      bytecodeHash,
      salt,
      constructor
    );
  }

  public async getCreate2Address(
    create2DeployerAddress: Address,
    create2Salt: string
  ): Promise<Address> {
    if (this.isZkSync)
      return await this.calculateZkCreate2Address(
        create2DeployerAddress,
        create2Salt
      );
    return await this.calculateEvmCreate2Address(
      create2DeployerAddress,
      create2Salt
    );
  }

  public async compareDeploymentTransaction(
    transaction: TransactionResponse | zk.types.TransactionResponse,
    deployment: Deployment
  ): Promise<boolean> {
    const newTransaction = await this.getDeployTransaction();
    const newData = newTransaction.data?.toString();
    if (this.isZkSync) {
      const currentFlattened = concat(deployment.factoryDeps || []);
      const newFlattened = concat(newTransaction.customData?.factoryDeps);

      return transaction.data !== newData || currentFlattened != newFlattened;
    } else {
      return transaction.data !== newData;
    }
  }

  getDeployedAddress(
    receipt: TransactionReceipt,
    options: DeployOptions,
    create2Address: string | undefined
  ): string {
    if (options.deterministicDeployment && create2Address) {
      return create2Address;
    }

    if (this.isZkSync) {
      const deployedAddresses = zk.utils
        .getDeployedContracts(receipt as unknown as zk.types.TransactionReceipt)
        .map((info) => info.deployedAddress);

      return deployedAddresses[deployedAddresses.length - 1];
    }

    return receipt.contractAddress!;
  }
}
