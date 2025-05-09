import { type ExecuteTransactionRequest, type ExecuteTransactionResponse } from "../types";
import { ethers } from "ethers";
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
import { HttpRpcClient } from "@account-abstraction/sdk";

// Arbitrum Sepolia chainId
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

// 实现Handler函数
const executeTransactionHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("开始执行交易，参数:", JSON.stringify(options, null, 2));

    // 提取参数
    const params: ExecuteTransactionRequest = {
        to: options?.to as string,
        value: options?.value as string || "0",
        data: options?.data as string || "0x",
        walletAddress: options?.walletAddress as string
    };

    console.log("解析后的参数:", JSON.stringify(params, null, 2));

    if (!params.to) {
        throw new Error("交易目标地址不能为空");
    }

    // 获取钱包API
    // 从runtime.providers中找到erc4337Wallet提供者
    console.log("查找erc4337Wallet提供者...");
    console.log("可用providers:", runtime.providers.map(p => (p as any).name || "未命名").join(", "));
    
    const provider = runtime.providers.find(p => (p as any).name === "erc4337Wallet");
    if (!provider) {
        console.error("找不到erc4337Wallet提供者，尝试手动创建...");
        
        // 直接从环境变量获取配置
        const rpcUrl = process.env.ERC4337_RPC_URL;
        const entryPointAddress = process.env.ERC4337_ENTRYPOINT_ADDRESS;
        const factoryAddress = process.env.ERC4337_FACTORY_ADDRESS;
        const ownerPrivateKey = process.env.ERC4337_OWNER_PRIVATE_KEY;
        
        console.log("环境变量检查:", {
            hasRpcUrl: !!rpcUrl,
            hasEntryPoint: !!entryPointAddress,
            hasFactory: !!factoryAddress,
            hasPrivateKey: !!ownerPrivateKey
        });
        
        if (!rpcUrl || !entryPointAddress || !factoryAddress || !ownerPrivateKey) {
            throw new Error("找不到erc4337Wallet提供者且环境变量不完整，无法继续执行");
        }
        
        // TODO: 这里可以添加逻辑来动态创建provider，类似于deployWallet.ts中的做法
        throw new Error("找不到erc4337Wallet提供者，请先部署钱包");
    }
    
    console.log("找到erc4337Wallet提供者");
    
    const accountAPI = (provider as any).accountAPI;
    if (!accountAPI) {
        console.error("AccountAPI未初始化，提供者详情:", JSON.stringify(provider, (key, value) => {
            if (typeof value === 'function') return '[Function]';
            return value;
        }, 2));
        throw new Error("AccountAPI未初始化");
    }
    
    console.log("AccountAPI初始化成功");
    
    // 获取配置和provider
    const config = (provider as any).config;
    const ethersProvider = (provider as any).provider;
    
    console.log("配置信息:", {
        rpcUrl: config?.rpcUrl ? "已设置" : "未设置",
        entryPointAddress: config?.entryPointAddress || "未设置",
        factoryAddress: config?.factoryAddress || "未设置",
        hasOwnerPrivateKey: !!config?.ownerPrivateKey,
    });
    
    // 创建bundler客户端
    console.log("创建HttpRpcClient，chainId:", ARBITRUM_SEPOLIA_CHAIN_ID);
    const bundlerClient = new HttpRpcClient(
        config.rpcUrl,
        config.entryPointAddress,
        ARBITRUM_SEPOLIA_CHAIN_ID
    );
    
    console.log("HttpRpcClient创建成功");
    
    // 1. 创建未签名的用户操作
    console.log("开始创建未签名的用户操作...");
    console.log("交易参数:", {
        target: params.to,
        value: params.value,
        data: params.data && params.data.length > 100 ? params.data.substring(0, 100) + "..." : params.data
    });
    
    let userOp;
    try {
        userOp = await accountAPI.createUnsignedUserOp({
            target: params.to,
            value: ethers.utils.parseEther(params.value),
            data: params.data
        });
        console.log("创建未签名的用户操作成功:", JSON.stringify({
            sender: userOp.sender,
            nonce: userOp.nonce?.toString() || "未设置",
            hasInitCode: !!userOp.initCode,
            hasCallData: !!userOp.callData,
        }, null, 2));
    } catch (error) {
        console.error("创建未签名的用户操作失败:", error);
        throw new Error(`创建未签名的用户操作失败: ${error.message}`);
    }
    
    // 确保所有必填字段都有值，并且格式正确
    // 确保sender是正确的字符串地址而不是对象
    let senderAddress = userOp.sender;
    if (!senderAddress || typeof senderAddress !== 'string') {
        console.log("sender不是有效字符串，尝试获取正确的地址");
        if (params.walletAddress) {
            console.log("使用参数中提供的钱包地址:", params.walletAddress);
            senderAddress = params.walletAddress;
        } else {
            console.log("尝试从accountAPI获取地址");
            try {
                senderAddress = await accountAPI.getCounterFactualAddress();
                console.log("获取地址成功:", senderAddress);
            } catch (error) {
                console.error("获取钱包地址失败:", error);
                throw new Error(`获取钱包地址失败: ${error.message}`);
            }
        }
    }
    
    // 确保initCode不是Promise对象
    console.log("检查并处理initCode...");
    let initCode = userOp.initCode || "0x";
    if (initCode && typeof initCode === 'object' && initCode.then) {
        console.log("initCode是Promise对象，等待解析...");
        try {
            initCode = await initCode;
            console.log("解析initCode成功:", initCode.substring(0, 50) + (initCode.length > 50 ? "..." : ""));
        } catch (error) {
            console.error("解析initCode失败:", error);
            initCode = "0x"; // 失败时使用空值
        }
    } else {
        console.log("initCode不是Promise，直接使用:", initCode.substring(0, 50) + (initCode.length > 50 ? "..." : ""));
    }
    
    // 注意：所有数值都必须是16进制字符串
    console.log("构建完整的用户操作...");
    const completeUserOp = {
        sender: senderAddress,
        nonce: ethers.utils.hexlify(userOp.nonce || 0),
        initCode: initCode,
        callData: userOp.callData || "0x",
        callGasLimit: ethers.utils.hexlify(1000000), // 使用16进制
        verificationGasLimit: ethers.utils.hexlify(5000000), // 使用16进制
        preVerificationGas: ethers.utils.hexlify(50000), // 使用16进制
        maxFeePerGas: ethers.utils.hexlify(userOp.maxFeePerGas || ethers.utils.parseUnits("10", "gwei")),
        maxPriorityFeePerGas: ethers.utils.hexlify(userOp.maxPriorityFeePerGas || ethers.utils.parseUnits("1", "gwei")),
        paymasterAndData: userOp.paymasterAndData || "0x",
        signature: "0x" + "11".repeat(65) // 使用65字节的假签名用于估算
    };
    
    console.log("完整用户操作创建成功:", JSON.stringify({
        sender: completeUserOp.sender,
        nonce: completeUserOp.nonce,
        initCodeLength: completeUserOp.initCode.length,
        callDataLength: completeUserOp.callData.length,
        callGasLimit: completeUserOp.callGasLimit,
        verificationGasLimit: completeUserOp.verificationGasLimit,
        preVerificationGas: completeUserOp.preVerificationGas,
        maxFeePerGas: completeUserOp.maxFeePerGas,
        maxPriorityFeePerGas: completeUserOp.maxPriorityFeePerGas,
        paymasterAndDataLength: completeUserOp.paymasterAndData.length,
        signatureLength: completeUserOp.signature.length
    }, null, 2));
    
    // 2. 使用65字节假签名估算gas
    console.log("使用bundler估算gas参数，使用65字节假签名...");
    let gasEstimate;
    try {
        gasEstimate = await bundlerClient.estimateUserOpGas(completeUserOp);
        console.log("估算gas成功:", JSON.stringify(gasEstimate, null, 2));
        
        // 确保gas估算值使用16进制格式
        if (gasEstimate.callGasLimit) {
            gasEstimate.callGasLimit = ethers.utils.hexlify(gasEstimate.callGasLimit);
            console.log("转换callGasLimit为16进制:", gasEstimate.callGasLimit);
        }
        if (gasEstimate.verificationGasLimit) {
            gasEstimate.verificationGasLimit = ethers.utils.hexlify(gasEstimate.verificationGasLimit);
            console.log("转换verificationGasLimit为16进制:", gasEstimate.verificationGasLimit);
        }
        if (gasEstimate.preVerificationGas) {
            gasEstimate.preVerificationGas = ethers.utils.hexlify(gasEstimate.preVerificationGas);
            console.log("转换preVerificationGas为16进制:", gasEstimate.preVerificationGas);
        }
    } catch (error) {
        console.error("使用bundler估算gas失败，详细错误:", error);
        console.log("使用bundler估算gas失败，使用手动设置的高值...");
        gasEstimate = {
            preVerificationGas: ethers.utils.hexlify(100000), // 增加到100000
            verificationGasLimit: ethers.utils.hexlify(10000000), // 增加到10000000
            callGasLimit: ethers.utils.hexlify(3000000) // 增加到3000000
        };
        console.log("使用手动设置的gas值:", JSON.stringify(gasEstimate, null, 2));
    }
    
    // 3. 将估算的gas值应用到用户操作
    const userOpWithGas = {
        ...completeUserOp,
        callGasLimit: gasEstimate.callGasLimit || completeUserOp.callGasLimit,
        verificationGasLimit: gasEstimate.verificationGasLimit || completeUserOp.verificationGasLimit,
        preVerificationGas: gasEstimate.preVerificationGas || completeUserOp.preVerificationGas
    };
    
    console.log("用户操作准备完成，签名前的值:", JSON.stringify({
        ...userOpWithGas,
        initCode: userOpWithGas.initCode.length > 100 ? userOpWithGas.initCode.substring(0, 100) + "..." : userOpWithGas.initCode,
        callData: userOpWithGas.callData.length > 100 ? userOpWithGas.callData.substring(0, 100) + "..." : userOpWithGas.callData,
        signature: userOpWithGas.signature.length > 100 ? userOpWithGas.signature.substring(0, 100) + "..." : userOpWithGas.signature
    }, null, 2));
    
    // 4. 获取真实签名
    let signature;
    try {
        console.log("开始签名用户操作...");
        // 重要：await结果，确保签名是字符串而不是Promise
        signature = await accountAPI.signUserOp(userOpWithGas);
        console.log("签名成功:", signature);
        
        // 检查签名格式
        if (typeof signature !== 'string') {
            console.error("签名不是字符串，而是:", typeof signature);
            console.error("签名内容:", signature);
            throw new Error("签名必须是字符串");
        }
        
        // 确保签名长度正确
        if (!ethers.utils.isHexString(signature)) {
            console.error("签名不是有效的16进制字符串:", signature);
            throw new Error("签名必须是有效的16进制字符串");
        }
        
        if (signature.length !== 132) { // 0x + 65*2=130 字符
            console.error("签名长度不正确:", signature.length, "应为132");
            throw new Error("签名长度必须是65字节(十六进制字符串长度132)");
        }
        
        console.log("签名验证成功，长度:", signature.length);
    } catch (error) {
        console.error("签名失败详细信息:", error);
        console.error("签名失败的用户操作:", JSON.stringify(userOpWithGas, null, 2));
        throw new Error(`生成签名失败: ${error.message}`);
    }
    
    // 5. 添加真实签名到用户操作
    const signedOp = {
        ...userOpWithGas,
        signature: signature
    };
    
    console.log("最终签名后的用户操作:", JSON.stringify(signedOp, null, 2));
    
    // 6. 发送用户操作
    console.log("开始发送用户操作...");
    let userOpHash;
    try {
        userOpHash = await bundlerClient.sendUserOpToBundler(signedOp);
        console.log("✅ 用户操作发送成功，哈希:", userOpHash);
    } catch (error) {
        console.error("===========================================");
        console.error("发送UserOp失败，完整错误对象:", JSON.stringify(error, (key, value) => {
            if (value instanceof Error) {
                return {
                    message: value.message,
                    stack: value.stack,
                    name: value.name,
                    ...value
                };
            }
            return value;
        }, 2));
        console.error("错误消息:", error.message);
        console.error("错误名称:", error.name);
        console.error("错误栈:", error.stack);
        console.error("===========================================");
        
        // 如果是gas不足错误，尝试增加gas值
        if (error.message && (
            error.message.includes("preVerificationGas") ||
            error.message.includes("intrinsic gas too low") ||
            error.message.includes("gas too low") ||
            error.message.includes("gas limit") ||
            error.message.includes("insufficient gas") ||
            error.message.includes("out of gas") ||
            error.message.includes("exceed gas limit")
        )) {
            console.log("检测到gas不足错误，尝试增加gas值");
            
            console.log("原始错误消息:", error.message);
            
            // 尝试从错误消息中提取所需的gas值
            let requiredGas = 0;
            const match = error.message.match(/want (\d+)/i) || 
                          error.message.match(/must be at least (\d+)/i) ||
                          error.message.match(/required (\d+)/i) ||
                          error.message.match(/minimum of (\d+)/i);
                          
            if (match && match[1]) {
                requiredGas = parseInt(match[1]);
                console.log(`解析出需要的最小gas: ${requiredGas}，尝试增加`);
            } else {
                // 如果无法解析，则简单地将当前值增加5倍
                const currentGas = parseInt(signedOp.preVerificationGas, 16);
                requiredGas = currentGas * 5;
                console.log(`无法从错误中解析gas值，将当前preVerificationGas值(${currentGas})增加5倍: ${requiredGas}`);
            }
            
            // 增加50%作为安全余量，并转为16进制
            const newPreGas = Math.ceil(requiredGas * 1.5);
            // 同时增加其他gas值，设置为极高值
            const newCallGas = Math.max(3000000, parseInt(signedOp.callGasLimit, 16) * 3);
            const newVerificationGas = Math.max(10000000, parseInt(signedOp.verificationGasLimit, 16) * 3);
            
            signedOp.preVerificationGas = ethers.utils.hexlify(newPreGas);
            signedOp.verificationGasLimit = ethers.utils.hexlify(newVerificationGas);
            signedOp.callGasLimit = ethers.utils.hexlify(newCallGas);
            
            console.log("使用增加的gas重试:", {
                preVerificationGas: signedOp.preVerificationGas,
                preVerificationGas_decimal: newPreGas,
                verificationGasLimit: signedOp.verificationGasLimit,
                verificationGasLimit_decimal: newVerificationGas,
                callGasLimit: signedOp.callGasLimit,
                callGasLimit_decimal: newCallGas
            });
            
            // 重新签名
            console.log("使用新的gas值重新签名...");
            try {
                signature = await accountAPI.signUserOp(signedOp);
                signedOp.signature = signature;
                console.log("重新签名成功");
                
                // 重试发送
                console.log("重试发送用户操作...");
                userOpHash = await bundlerClient.sendUserOpToBundler(signedOp);
                console.log("✅ 使用增加的gas发送成功，哈希:", userOpHash);
            } catch (signingError) {
                console.error("重新签名或发送失败:", signingError);
                throw new Error(`尝试增加gas后签名或发送失败: ${signingError.message}`);
            }
        } else if (error.message && error.message.includes("invalid sender")) {
            console.error("检测到无效发送者错误，钱包可能尚未部署");
            throw new Error("无效发送者地址，钱包可能尚未部署。请先部署钱包后再执行交易。");
        } else if (error.message && error.message.includes("execution reverted")) {
            console.error("检测到执行回滚错误，可能是交易内容有问题");
            throw new Error(`交易执行失败: ${error.message}`);
        } else {
            console.error("未知错误类型，无法自动修复");
            throw error;
        }
    }
    
    const response: ExecuteTransactionResponse = {
        userOpHash,
        success: true,
        // transactionHash可能会在后续从链上事件获取
    };
    
    // 构建响应内容
    const responseContent = {
        text: `交易已执行!\n用户操作哈希: ${response.userOpHash}\n状态: ${response.success ? '成功' : '失败'}${response.transactionHash ? `\n交易哈希: ${response.transactionHash}` : ''}`,
    };

    // 如果有回调函数，调用它
    if (callback) {
        await callback(responseContent);
    }
    
    return response;
};

// 实现验证函数
const validateExecuteTransaction = async (runtime, message, state) => {
    // 这里可以添加逻辑来检查是否应该运行此操作
    return true;
};

// 创建完全兼容的Action对象
export const executeTransactionAction: Action = {
    name: "executeTransaction",
    description: "通过ERC-4337钱包执行交易",
    similes: ["发送交易", "转账", "调用智能合约"],
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
        ]
    ]
};