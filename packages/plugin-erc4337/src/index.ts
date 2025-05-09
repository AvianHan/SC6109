// 导出所有组件
export * from "./actions/deployWallet";
export * from "./actions/executeTransaction";
export * from "./providers/wallet";
export * from "./types";

import type { Plugin } from "@elizaos/core";
import { deployWalletAction } from "./actions/deployWallet";
import { executeTransactionAction } from "./actions/executeTransaction";
import { erc4337WalletProvider, erc4337WalletProviderDefinition } from "./providers/wallet";

// 创建完全符合类型要求的插件
export const erc4337Plugin: Plugin = {
    name: "erc4337",
    description: "ERC-4337 账户抽象钱包集成插件",
    providers: [erc4337WalletProvider],
    evaluators: [],
    services: [],
    actions: [deployWalletAction, executeTransactionAction],
    
    // 添加初始化方法
    config: {
        providerDefinitions: [erc4337WalletProviderDefinition]
    }
};

console.log("ERC-4337 账户抽象钱包插件已加载");

export default erc4337Plugin;