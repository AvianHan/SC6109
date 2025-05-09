import { BigNumberish, Signer, BigNumber, ethers } from 'ethers';
import { Provider } from '@ethersproject/providers';

declare module '@account-abstraction/contracts' {
    export interface UserOperationStruct {
        sender: string;
        nonce: bigint;
        initCode: string;
        callData: string;
        callGasLimit: bigint;
        verificationGasLimit: bigint;
        preVerificationGas: bigint;
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
        paymasterAndData: string;
        signature: string;
    }

    export interface SimpleAccount {
        execute(target: string, value: BigNumberish, data: string): Promise<any>;
        getCounterFactualAddress(): Promise<string>;
        getNonce(): Promise<BigNumber>;
    }

    export interface SimpleAccountFactory {
        createAccount(owner: string, salt: BigNumberish): Promise<string>;
        getAddress(owner: string, salt: BigNumberish): Promise<string>;
    }
}

declare module '@account-abstraction/sdk' {
    import { Provider } from '@ethersproject/providers';
    import { BigNumberish, BigNumber, Signer } from 'ethers';
    import { UserOperationStruct } from '@account-abstraction/contracts';
    
    export interface BaseApiParams {
        provider: Provider;
        entryPointAddress: string;
        accountAddress?: string;
        overheads?: any;
        paymasterAPI?: any;
    }
    
    export interface SimpleAccountApiParams extends BaseApiParams {
        owner: Signer;
        factoryAddress?: string;
        index?: BigNumberish;
    }

    export interface TransactionDetailsForUserOp {
        target: string;
        data: string;
        value?: BigNumberish;
        gasLimit?: BigNumberish;
        maxFeePerGas?: BigNumberish;
        maxPriorityFeePerGas?: BigNumberish;
        nonce?: BigNumberish;
    }
    
    export class SimpleAccountAPI {
        factoryAddress?: string;
        owner: Signer;
        index: BigNumberish;
        accountContract?: any;
        factory?: any;
        
        constructor(params: SimpleAccountApiParams);
        
        getAccountInitCode(): Promise<string>;
        getNonce(): Promise<BigNumber>;
        getCounterFactualAddress(): Promise<string>;
        signUserOp(userOp: UserOperationStruct): Promise<UserOperationStruct>;
        createSignedUserOp(info: TransactionDetailsForUserOp): Promise<UserOperationStruct>;
    }
    
    export class HttpRpcClient {
        constructor(
            provider: Provider,
            entryPointAddress: string,
            bundlerUrl: string
        );
        
        sendUserOpToBundler(userOp: any): Promise<string>;
        estimateUserOpGas(userOp: Partial<UserOperationStruct>): Promise<{
            callGasLimit: number;
            preVerificationGas: number;
            verificationGas: number;
        }>;
    }
} 