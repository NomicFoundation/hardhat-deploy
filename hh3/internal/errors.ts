import { bnReplacer } from './utils.js';

export class UnknownSignerError extends Error {
  constructor(
    public data: {
      from: string;
      to?: string;
      data?: string;
      value?: string | bigint;
      contract?: {name: string; method: string; args: unknown[]};
    }
  ) {
    super(
      `Unknown Signer for account: ${
        data.from
      } Trying to execute the following::\n ${JSON.stringify(
        data,
        bnReplacer,
        '  '
      )}`
    );
    Error.captureStackTrace(this, UnknownSignerError);
  }
}
