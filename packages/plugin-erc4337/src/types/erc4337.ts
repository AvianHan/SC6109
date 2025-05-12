import { BigNumberish } from "ethers";

export interface UserOperationStruct {
    sender: string;
    nonce: BigNumberish;
    initCode: string;
    callData: string;
    callGasLimit: BigNumberish;
    verificationGasLimit: BigNumberish;
    preVerificationGas: BigNumberish;
    maxFeePerGas: BigNumberish;
    maxPriorityFeePerGas: BigNumberish;
    paymasterAndData: string;
    signature: string;
} 