/**
 * ERC-4337账户抽象钱包信息查询模块
 * 
 * 本模块提供了查询ERC-4337账户抽象钱包信息的功能
 * 实现了完整的钱包信息查询流程：
 * 1. 从runtime获取已初始化的provider
 * 2. 获取钱包的反事实地址
 * 3. 检查钱包部署状态
 * 4. 获取所有者地址信息
 * 5. 返回格式化的钱包信息
 */
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
import { ethers } from "ethers";
import { Erc4337WalletManager } from "../utils/walletManager";

/**
 * 处理查询ERC-4337账户抽象钱包信息的主函数
 * 
 * @param runtime 运行时环境，包含提供者和其他资源
 * @param message 内存对象
 * @param state 可选的状态对象
 * @param options 可选的参数对象
 * @param callback 可选的回调函数，用于返回操作结果
 * @returns 钱包信息对象
 */
const getWalletInfoHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("⭐ 开始执行getWalletInfo操作");
    
    try {
        // 1. 从runtime获取已初始化的provider实例
        console.log(`检查runtime中的provider实例，共有${runtime.providers.length}个providers`);
        const providerInstance = runtime.providers.find(
            p => p && typeof p === 'object' && 'name' in p && p.name === "erc4337Wallet"
        ) as any;

        // 如果未找到已初始化的provider，报错退出
        if (!providerInstance || !providerInstance.walletManager) {
            throw new Error("钱包未初始化，请先通过其他操作(如deployWallet)触发钱包初始化");
        }
        
        console.log("从runtime中找到已初始化的钱包管理器");
        const walletManager: Erc4337WalletManager = providerInstance.walletManager;
        
        // 2. 获取钱包地址
        console.log("获取钱包反事实地址...");
        const walletAddress = await walletManager.getCounterFactualAddress();
        
        // 3. 检查钱包是否已部署
        console.log("检查钱包部署状态...");
        const isDeployed = await walletManager.isDeployed();
        
        // 4. 获取所有者地址
        console.log("获取所有者地址...");
        const ownerAddress = await walletManager.getOwnerAddress();
        
        // 5. 构建响应对象
        const response = {
            walletAddress,
            ownerAddress,
            isDeployed
        };
        
        // 6. 构建响应内容
        const walletInfoText = `
ERC-4337钱包信息:
钱包地址: ${walletAddress}
所有者地址: ${ownerAddress}
部署状态: ${isDeployed ? '已部署' : '未部署'}
        `.trim();
        
        console.log("钱包信息查询完成:", response);
        
        // 7. 如果有回调函数，执行回调
        if (callback) {
            await callback({
                text: walletInfoText
            });
        }
        
        return response;
    } catch (error) {
        console.error("⚠️ getWalletInfo主函数错误:", error);
        console.error("错误消息:", error.message);
        
        if (error.stack) {
            console.error("错误堆栈:", error.stack);
        }
        
        // 构建错误响应
        const errorText = `
获取钱包信息失败:
错误信息: ${error.message}
请确保已正确配置钱包参数并已初始化钱包。
        `.trim();
        
        if (callback) {
            await callback({
                text: errorText
            });
        }
        
        throw error;
    }
};

/**
 * 验证getWalletInfo操作的函数
 * 
 * 当前实现总是返回true，允许操作执行。
 * 
 * @param runtime 运行时环境
 * @param message 内存对象
 * @param state 状态对象
 * @returns 布尔值，表示是否允许操作执行
 */
const validateGetWalletInfo = async (runtime, message, state) => {
    return true;
};

/**
 * ERC-4337账户抽象钱包信息查询Action定义
 * 
 * 定义了完整的Action对象，包括名称、描述、处理函数和验证函数。
 */
export const getWalletInfoAction: Action = {
    name: "getWalletInfo",
    description: "查询ERC-4337账户抽象钱包信息",
    similes: ["查看钱包", "获取钱包地址", "钱包信息", "钱包状态"],
    handler: getWalletInfoHandler,
    validate: validateGetWalletInfo,
    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "查看我的钱包信息",
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在查询您的ERC-4337钱包信息...",
                }
            }
        ],
        [
            {
                user: "user1",
                content: {
                    text: "我想知道我的钱包地址",
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在获取您的钱包地址信息...",
                }
            }
        ]
    ]
}; 