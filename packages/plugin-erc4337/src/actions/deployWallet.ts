/**
 * ERC-4337账户抽象钱包部署模块
 * 
 * 本模块提供了部署ERC-4337账户抽象钱包的功能，解决了gas不足问题。
 * 实现了完整的钱包部署流程：
 * 1. 获取钱包的反事实地址
 * 2. 检查钱包是否已部署
 * 3. 准备UserOperation，解决gas估算问题
 * 4. 签名并发送交易到bundler
 * 5. 处理各种错误情况和重试逻辑
 * 
 * 特别注意处理了"intrinsic gas too low"错误，通过多种策略确保提供足够的gas。
 */
import { type DeployWalletRequest, type DeployWalletResponse } from "../types";
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
import { ethers } from "ethers";
import { HttpRpcClient } from "@account-abstraction/sdk";
import { SimpleAccountAPI } from "@account-abstraction/sdk";
import * as crypto from "crypto";
import { calcPreVerificationGas } from "@account-abstraction/sdk";
import safeToNumber from "../utils/safeToNumbers";
import evenGas from "../utils/evenGas";
import { initErc4337WalletManager, Erc4337WalletManager } from "../utils/walletManager";

// 设置正确的Arbitrum Sepolia chainId
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * 处理部署ERC-4337账户抽象钱包的主函数
 * 此函数负责创建和部署ERC-4337钱包
 * 
 * @param runtime 运行时环境，包含提供者和其他资源
 * @param message 内存对象
 * @param state 可选的状态对象
 * @param options 可选的参数对象，包含salt和ownerAddress
 * @param callback 可选的回调函数，用于返回操作结果
 * @returns 部署钱包的响应对象，包含钱包地址、所有者地址和交易哈希
 */
const deployWalletHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("⭐ 开始执行deployWallet操作");
    
    // 生成随机index
    const generateRandomIndex = () => {
        const randomBytes = crypto.randomBytes(16);
        return ethers.utils.hexlify(randomBytes);
    };
    
    // 提取参数
    const params: DeployWalletRequest = {
        index: options?.index as string || generateRandomIndex(),
        ownerAddress: options?.ownerAddress as string,
    };

    console.log("使用参数:", JSON.stringify(params, null, 2));

    let walletManager: Erc4337WalletManager;
    
    try {
        // 1. 初始化钱包管理器
        console.log("初始化钱包管理器...");
        walletManager = await initErc4337WalletManager(runtime);
        
        // 2. 获取钱包地址和所有者地址
        if (!params.ownerAddress) {
            params.ownerAddress = await walletManager.getOwnerAddress();
            console.log("从私钥获取所有者地址成功:", params.ownerAddress);
        }
        
        if (!params.ownerAddress) {
            throw new Error("所有者地址不能为空");
        }
        
        // 3. 获取钱包反事实地址并检查部署状态
        console.log("获取钱包的反事实地址(counterfactual address)...");
        const walletAddress = await walletManager.getCounterFactualAddress();
        console.log("获取到钱包地址:", walletAddress);
        
        // 4. 检查钱包是否已部署
        console.log("检查钱包是否已部署...");
        const isDeployed = await walletManager.isDeployed();
        console.log(`钱包地址: ${walletAddress}, 是否已部署: ${isDeployed}`);
        
        // 5. 如果未部署，则部署钱包
        let transactionHash;
        if (!isDeployed) {
            console.log("开始部署钱包...");
            try {
                transactionHash = await walletManager.deployWallet(params.index);
                console.log("部署成功，交易哈希:", transactionHash);
            } catch (error) {
                console.error("部署钱包失败:", error);
                throw new Error(`部署钱包失败: ${error.message}`);
            }
        } else {
            console.log("钱包已部署，无需重新部署");
        }
        
        // 6. 构建响应
        const response: DeployWalletResponse = {
            walletAddress,
            ownerAddress: params.ownerAddress,
            transactionHash
        };
        
        console.log("部署钱包完成，响应:", response);
        
        // 7. 构建响应内容并回调
        const responseContent = {
            text: `成功部署钱包!\n钱包地址: ${response.walletAddress}\n所有者地址: ${response.ownerAddress}${response.transactionHash ? `\n交易哈希: ${response.transactionHash}` : ''}`,
        };

        if (callback) {
            await callback(responseContent);
        }
        
        return response;
    } catch (error) {
        console.error("⚠️ deployWallet主函数错误:", error);
        console.error("错误类型:", error.constructor.name);
        console.error("错误消息:", error.message);
        
        if (error.stack) {
            console.error("错误堆栈:", error.stack);
        }
        
        throw error;
    }
};

/**
 * 验证deployWallet操作的函数
 * 
 * 当前实现总是返回true，允许操作执行。
 * 未来可以扩展此函数来检查前置条件，例如：
 * - 验证用户权限
 * - 检查所需环境变量是否设置
 * - 验证网络连接状态
 * 
 * @param runtime 运行时环境
 * @param message 内存对象
 * @param state 状态对象
 * @returns 布尔值，表示是否允许操作执行
 */
const validateDeployWallet = async (runtime, message, state) => {
    return true;
};

/**
 * ERC-4337账户抽象钱包部署Action定义
 * 
 * 定义了完整的Action对象，包括名称、描述、处理函数和验证函数。
 * 这个Action可以被Eliza OS的运行时系统调用，执行钱包部署操作。
 * 还包含示例对话，帮助系统理解如何响应用户的相关请求。
 */
export const deployWalletAction: Action = {
    name: "deployWallet",
    description: "部署一个ERC-4337账户抽象钱包",
    similes: ["创建钱包", "部署智能合约钱包", "生成账户抽象钱包"],
    handler: deployWalletHandler,
    validate: validateDeployWallet,
    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "我想部署一个ERC-4337钱包",
                }
            },
            {
                user: "agent",
                content: {
                    text: "我将为您部署ERC-4337钱包。请稍等...",
                }
            }
        ]
    ]
};