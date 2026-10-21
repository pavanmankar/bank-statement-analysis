import { maskDigits } from "./chat/mask.js";

export function logInfo(message: string): void {
  console.log(maskDigits(message));
}
