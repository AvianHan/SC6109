/**
 * ERC-4337账户抽象钱包交易执行模块
 * 
 * 本模块提供了通过ERC-4337账户抽象钱包执行交易的功能，解决了gas估算和调整问题。
 * 实现了完整的交易执行流程：
 * 1. 从runtime获取已初始化的钱包管理器
 * 2. 创建用户操作并估算gas
 * 3. 签名并发送交易到bundler
 * 4. 处理各种错误情况和重试逻辑
 * 
 * 特别注意处理了gas不足错误，通过智能调整gas确保交易能够成功执行。
 */
import { type ExecuteTransactionRequest, type ExecuteTransactionResponse } from "../types";
import { ethers } from "ethers";
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
import { HttpRpcClient } from "@account-abstraction/sdk";
import { Erc4337WalletManager } from "../utils/walletManager";
import safeToNumber from "../utils/safeToNumbers";
import evenGas from "../utils/evenGas";

// Arbitrum Sepolia chainId
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * 处理执行ERC-4337账户抽象钱包交易的主函数
 * 
 * @param runtime 运行时环境，包含提供者和其他资源
 * @param message 内存对象
 * @param state 可选的状态对象
 * @param options 可选的参数对象，包含to、value和data
 * @param callback 可选的回调函数，用于返回操作结果
 * @returns 交易执行的响应对象，包含userOpHash和success状态
 */
const executeTransactionHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("⭐ 开始执行executeTransaction操作");
    console.log("传入参数:", JSON.stringify(options, null, 2));

    // 从message中提取参数
    let toAddress: string | undefined;
    let value: string | undefined;
    let data: string | undefined;

    // 尝试从message.content.text中解析参数
    if (message?.content?.text) {
        const text = message.content.text;
        // 匹配"发送X ETH到地址"的格式
        const sendMatch = text.match(/发送\s*(\d+(?:\.\d+)?)\s*ETH\s*到\s*(0x[a-fA-F0-9]{40})/);
        if (sendMatch) {
            value = sendMatch[1];
            toAddress = sendMatch[2];
        }
    }

    // 提取参数，优先使用message中解析的参数，其次使用options中的参数
    const params: ExecuteTransactionRequest = {
        to: toAddress || options?.to as string,
        value: value || options?.value as string || "0",
        data: data || options?.data as string || "0x",
    };

    console.log("解析后的参数:", JSON.stringify(params, null, 2));

    if (!params.to) {
        throw new Error("交易目标地址不能为空");
    }

    try {
        // 1. 从runtime获取已初始化的provider实例
        console.log(`检查runtime中的provider实例，共有${runtime.providers.length}个providers`);
        const providerInstance = runtime.providers.find(
            p => p && typeof p === 'object' && 'name' in p && p.name === "erc4337Wallet"
        ) as any;

        // 如果未找到已初始化的provider，报错退出
        if (!providerInstance || !providerInstance.walletManager) {
            throw new Error("钱包未初始化，请先执行deployWallet操作");
        }
        
        console.log("从runtime中找到已初始化的钱包管理器");
        const walletManager: Erc4337WalletManager = providerInstance.walletManager;
        
        // 2. 检查钱包是否已部署
        console.log("检查钱包是否已部署...");
        const walletAddress = await walletManager.getCounterFactualAddress();
        const isDeployed = await walletManager.isDeployed();
        
        if (!isDeployed) {
            throw new Error(`钱包${walletAddress}尚未部署，请先执行deployWallet操作`);
        }
        
        // 3. 准备交易参数
        console.log("准备交易参数...");
        let valueWei = ethers.BigNumber.from(0);
        
        if (params.value && params.value !== "0") {
            try {
                valueWei = ethers.utils.parseEther(params.value);
                console.log(`解析交易金额: ${params.value} ETH = ${valueWei.toString()} Wei`);
            } catch (error) {
                console.error("解析交易金额失败:", error);
                throw new Error(`无效的交易金额: ${params.value}`);
            }
        }
        
        // 4. 创建Bundler客户端
        console.log("创建HttpRpcClient...");
        const bundlerClient = new HttpRpcClient(
            walletManager.config.rpcUrl,
            walletManager.config.entryPointAddress,
            ARBITRUM_SEPOLIA_CHAIN_ID
        );
        
        // 5. 创建未签名用户操作
        console.log("创建未签名用户操作...");
        const userOp = await walletManager.accountAPI.createUnsignedUserOp({
            target: params.to,
            data: params.data,
            value: valueWei
        });
        
        // 6. 初始用户操作
        console.log("构建初始用户操作...");
        const initialUserOp = {
            sender: walletAddress,
            nonce: userOp.nonce ? ethers.utils.hexlify(await safeToNumber(userOp.nonce, 0)) : "0x00",
            initCode: userOp.initCode || "0x",
            callData: userOp.callData || "0x",
            callGasLimit: "0x0", 
            verificationGasLimit: "0x0", 
            preVerificationGas: "0x0",
            maxFeePerGas: userOp.maxFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxFeePerGas, 1700000000)) : ethers.utils.hexlify(1700000000),
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxPriorityFeePerGas, 1500000000)) : ethers.utils.hexlify(1500000000),
            paymasterAndData: userOp.paymasterAndData || "0x",
            signature: "0x"
        };
        
        // 7. 获取有效签名用于估算gas
        let tempSignature = await walletManager.accountAPI.signUserOp(initialUserOp as any);
        
        // 处理签名可能是对象的情况
        if (tempSignature && typeof tempSignature === 'object') {
            console.log("首次签名返回了对象类型，尝试解析...");
            if (tempSignature.signature) {
                tempSignature = tempSignature.signature;
            }
        }
        
        // 8. 创建用于估算gas的带签名用户操作
        const signedUserOpForEstimation = {
            ...initialUserOp,
            signature: tempSignature
        };
        
        // 9. 估算gas
        let gasEstimate;
        try {
            console.log("估算用户操作gas...");
            gasEstimate = await bundlerClient.estimateUserOpGas(signedUserOpForEstimation as any);
            // 确保gas值是偶数，以避免某些验证器的限制
            gasEstimate = evenGas(gasEstimate);
            console.log("gas估算结果:", gasEstimate);
        } catch (error) {
            console.log("估算gas失败:", error);
        }
        
        // 10. 更新用户操作为最终估算的gas值
        const updatedUserOp = {
            ...signedUserOpForEstimation,
            callGasLimit: gasEstimate.callGasLimit ? ethers.utils.hexlify(gasEstimate.callGasLimit) : ethers.utils.hexlify(500000),
            verificationGasLimit: gasEstimate.verificationGasLimit ? ethers.utils.hexlify(gasEstimate.verificationGasLimit) : ethers.utils.hexlify(2000000),
            preVerificationGas: gasEstimate.preVerificationGas ? ethers.utils.hexlify(gasEstimate.preVerificationGas) : ethers.utils.hexlify(100000)
        };
        
        // 11. 最终签名
        console.log("对最终用户操作进行签名...");
        let finalSignature = await walletManager.accountAPI.signUserOp(updatedUserOp as any);
        
        // 处理签名可能是对象的情况
        if (finalSignature && typeof finalSignature === 'object') {
            if (finalSignature.signature) {
                finalSignature = finalSignature.signature;
            }
        }
        
        // 12. 创建最终用户操作
        const finalUserOp = {
            ...updatedUserOp,
            signature: finalSignature
        };
        
        console.log("最终用户操作准备完成:", {
            sender: finalUserOp.sender,
            target: params.to,
            value: params.value,
            dataLength: params.data.length,
            callGasLimit: finalUserOp.callGasLimit,
            verificationGasLimit: finalUserOp.verificationGasLimit,
            preVerificationGas: finalUserOp.preVerificationGas
        });
        
        // 13. 发送用户操作到Bundler
        let userOpHash;
        try {
            console.log("发送用户操作到Bundler...");
            userOpHash = await bundlerClient.sendUserOpToBundler(finalUserOp as any);
            console.log("✅ 用户操作发送成功，哈希:", userOpHash);
        } catch (error) {
            // 处理特殊错误情况
            if (error.message && error.message.includes("already known")) {
                console.log("操作已知，可能已在处理中");
                userOpHash = "已知操作，无明确哈希";
            } else if (error.message && error.message.includes("gas")) {
                console.error("Gas相关错误:", error.message);
                
                // 尝试增加gas
                console.log("尝试增加gas重新发送...");
                
                const increasedUserOp = {
                    ...finalUserOp,
                    callGasLimit: ethers.utils.hexlify(parseInt(finalUserOp.callGasLimit, 16) * 2),
                    verificationGasLimit: ethers.utils.hexlify(parseInt(finalUserOp.verificationGasLimit, 16) * 2),
                    preVerificationGas: ethers.utils.hexlify(parseInt(finalUserOp.preVerificationGas, 16) * 2)
                };
                
                // 用新的gas值重新签名
                const newSignature = await walletManager.accountAPI.signUserOp(increasedUserOp as any);
                increasedUserOp.signature = typeof newSignature === 'object' ? newSignature.signature : newSignature;
                
                try {
                    userOpHash = await bundlerClient.sendUserOpToBundler(increasedUserOp as any);
                    console.log("✅ 使用增加的gas发送成功，哈希:", userOpHash);
                } catch (retryError) {
                    console.error("使用增加的gas重试失败:", retryError);
                    throw new Error(`交易发送失败: ${retryError.message}`);
                }
            } else {
                console.error("发送用户操作失败:", error);
                throw new Error(`交易发送失败: ${error.message}`);
            }
        }
        
        // 14. 构建响应对象
        const response: ExecuteTransactionResponse = {
            userOpHash,
            success: true
        };
        
        // 15. 构建用户响应文本
        const responseText = `
交易已发送:
目标地址: ${params.to}
金额: ${params.value} ETH
数据长度: ${params.data === "0x" ? "0 (无数据)" : params.data.length/2-1 + " 字节"}
操作哈希: ${userOpHash}
状态: ${response.success ? '已提交' : '失败'}

交易已提交到区块链，将在几分钟内处理完成。
        `.trim();
        
        // 16. 如果有回调函数，执行回调
        if (callback) {
            await callback({
                text: responseText
            });
        }
        
        return response;
    } catch (error) {
        console.error("⚠️ executeTransaction主函数错误:", error);
        console.error("错误消息:", error.message);
        
        if (error.stack) {
            console.error("错误堆栈:", error.stack);
        }
        
        // 构建错误响应
        const errorText = `
执行交易失败:
错误信息: ${error.message}
请确保钱包已部署且配置正确。
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
 * 验证executeTransaction操作的函数
 * 
 * 当前实现总是返回true，允许操作执行。
 * 
 * @param runtime 运行时环境
 * @param message 内存对象
 * @param state 状态对象
 * @returns 布尔值，表示是否允许操作执行
 */
const validateExecuteTransaction = async (runtime, message, state) => {
    return true;
};

/**
 * ERC-4337账户抽象钱包交易执行Action定义
 * 
 * 定义了完整的Action对象，包括名称、描述、处理函数和验证函数。
 */
export const executeTransactionAction: Action = {
    name: "executeTransaction",
    description: "通过ERC-4337钱包执行交易",
    similes: ["发送交易", "转账", "调用智能合约", "发送ETH", "执行合约调用"],
    handler: executeTransactionHandler,
    validate: validateExecuteTransaction,
    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "我想发送0.1 ETH到0x123...",
                }
            },
            {
                user: "agent",
                content: {
                    text: "我将为您执行交易。请稍等...",
                }
            }
        ],
        [
            {
                user: "user1",
                content: {
                    text: "调用合约0x456...",
                }
            },
            {
                user: "agent",
                content: {
                    text: "正在准备合约调用交易...",
                }
            }
        ]
    ]
};