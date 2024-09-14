import { HexString } from "@pythnetwork/price-service-client";
import log4js from 'log4js';

export type PctNumber = number;
export type DurationInSeconds = number;
export const txSpeeds = ["slow", "standard", "fast"] as const;
export type TxSpeed = typeof txSpeeds[number];
export const customGasChainIds = [137] as const;
export type CustomGasChainId = typeof customGasChainIds[number];

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function removeLeading0x(id: HexString): HexString {
  if (id.startsWith("0x")) {
    return id.substring(2);
  }
  return id;
}

export function addLeading0x(id: HexString): HexString {
  if (id.startsWith("0x")) {
    return id;
  }
  return "0x" + id;
}

export function isWsEndpoint(endpoint: string): boolean {
  const url = new URL(endpoint);
  const protocol = url.protocol;

  if (protocol === "ws:" || protocol == "wss:") {
    return true;
  }

  return false;
}

export function verifyValidOption<
  options extends Readonly<Array<any>>,
  validOption extends options[number]
>(option: any, validOptions: options) {
  if (validOptions.includes(option)) {
    return option as validOption;
  }
  const errorString =
    option + " is not a valid option. Please choose between " + validOptions;
  throw new Error(errorString);
}

log4js.configure({
  appenders: {
    dateFileAppender: {
      type: 'dateFile',
      filename: 'logs/price_pusher',
      pattern: 'yyyy-MM-dd.log',
      // keepFileExt: true,
      daysToKeep: 7,
      compress: true,
      maxLogSize: 1024 * 1024 * 1024,
      alwaysIncludePattern: true
    }
  },
  categories: {
    default: { appenders: ['dateFileAppender'], level: 'info' }
  }
});

export const businessLogger = log4js.getLogger();