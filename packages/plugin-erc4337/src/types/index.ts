import { ethers } from "ethers";
import type { Provider as CoreProvider } from "@elizaos/core";

/**
 * 定义提供者类别枚举
 */
export enum ProviderCategory {
    WALLET = "wallet",
    STORAGE = "storage",
    API = "api"
}

/**
 * 定义提供者接口
 * 确保兼容Core包中的Provider接口
 */
export interface Provider extends CoreProvider {
    // 继承自CoreProvider，已包含get方法
}

/**
 * 定义提供者定义接口
 */
export interface ProviderDefinition {
    name: string;
    category: ProviderCategory;
    init: (runtime: any) => any;
}

export interface ERC4337WalletConfig {
    rpcUrl: string;
    entryPointAddress: string;
    factoryAddress: string;
    ownerPrivateKey?: string;
}

export interface DeployWalletRequest {
    index?: string;
    ownerAddress?: string;
}

export interface DeployWalletResponse {
    walletAddress: string;
    ownerAddress: string;
    transactionHash?: string;
}

export interface ExecuteTransactionRequest {
    to: string;
    value?: string;
    data?: string;
    walletAddress?: string;
}

export interface ExecuteTransactionResponse {
    userOpHash: string;
    transactionHash?: string;
    success: boolean;
}