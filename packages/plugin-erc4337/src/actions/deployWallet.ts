import { type DeployWalletRequest, type DeployWalletResponse } from "../types";
import { type Action, type State, type Memory, type Handler, type HandlerCallback } from "@elizaos/core";
import { ethers } from "ethers";
import { HttpRpcClient } from "@account-abstraction/sdk";
import { UserOperationStruct } from "../types/erc4337";
import { SimpleAccountAPI } from "@account-abstraction/sdk";
import { Provider as EthersProvider } from '@ethersproject/providers';
import { type ERC4337WalletConfig } from "../types";
import { utils } from "ethers";
import * as crypto from "crypto";
import { calcPreVerificationGas } from "@account-abstraction/sdk";

// 设置正确的Arbitrum Sepolia chainId
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * 安全地将任何值转换为数字
 * @param value 要转换的值
 * @param defaultValue 如果转换失败，返回的默认值
 * @returns 转换后的数字或默认值
 */
async function safeToNumber(value: any, defaultValue: number): Promise<number> {
    try {
        // 处理空值
        if (value === null || value === undefined) {
            console.log("safeToNumber: 值为空，返回默认值", defaultValue);
            return defaultValue;
        }
        
        // 处理Promise
        if (value && typeof value === 'object' && value.then) {
            console.log("safeToNumber: 值是Promise，等待解析...");
            try {
                value = await value;
                console.log("safeToNumber: Promise解析成功，结果类型:", typeof value);
            } catch (error) {
                console.error("safeToNumber: Promise解析失败:", error);
                return defaultValue;
            }
        }
        
        // 处理BigNumber、BigInt等对象
        if (value && typeof value === 'object') {
            if (value._isBigNumber || value.type === 'BigNumber') {
                console.log("safeToNumber: 值是BigNumber对象");
                return value.toNumber();
            }
            if (typeof value.toString === 'function') {
                console.log("safeToNumber: 值是对象，使用toString()");
                value = value.toString();
            }
        }
        
        // 处理字符串和数字
        if (typeof value === 'string' || typeof value === 'number') {
            const num = Number(value);
            if (!isNaN(num)) {
                return num;
            }
            console.log("safeToNumber: 不是有效数字:", value);
        }
        
        console.log("safeToNumber: 无法转换为数字，返回默认值", defaultValue);
        return defaultValue;
    } catch (error) {
        console.error("safeToNumber: 出错，返回默认值:", error);
        return defaultValue;
    }
}

// 实现Handler函数
const deployWalletHandler: Handler = async (
    runtime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
) => {
    console.log("⭐ 开始执行deployWallet操作");
    // 提取参数
    const params: DeployWalletRequest = {
        salt: options?.salt as string || ethers.utils.hexlify(crypto.randomBytes(32)),
        ownerAddress: options?.ownerAddress as string
    };

    console.log("使用参数:", JSON.stringify(params, null, 2));

    // 获取钱包API
    let provider = runtime.providers.find(p => (p as any).name === "erc4337Wallet");
    let accountAPI;
    let config;
    
    if (!provider) {
        console.log("找不到erc4337Wallet提供者，尝试使用环境变量创建新的提供者实例");
        
        // 直接从环境变量获取配置
        const rpcUrl = process.env.ERC4337_RPC_URL;
        const entryPointAddress = process.env.ERC4337_ENTRYPOINT_ADDRESS;
        const factoryAddress = process.env.ERC4337_FACTORY_ADDRESS;
        const ownerPrivateKey = process.env.ERC4337_OWNER_PRIVATE_KEY;
        
        console.log("环境变量检查:");
        console.log(`- RPC URL: ${rpcUrl ? '已设置' : '未设置'}`);
        console.log(`- EntryPoint地址: ${entryPointAddress ? '已设置' : '未设置'}`);
        console.log(`- Factory地址: ${factoryAddress ? '已设置' : '未设置'}`);
        console.log(`- 私钥: ${ownerPrivateKey ? '已设置(隐藏)' : '未设置'}`);
        
        if (!rpcUrl || !entryPointAddress || !factoryAddress || !ownerPrivateKey) {
            throw new Error("缺少ERC4337配置参数，请检查环境变量");
        }
        
        // 创建配置对象
        config = {
            rpcUrl,
            entryPointAddress,
            factoryAddress,
            ownerPrivateKey
        };
        
        // 创建provider时明确指定Arbitrum Sepolia网络信息
        const arbitrumSepoliaNetwork = {
            name: "arbitrum-sepolia",
            chainId: ARBITRUM_SEPOLIA_CHAIN_ID
        };
        
        console.log("创建JsonRpcProvider，使用网络:", JSON.stringify(arbitrumSepoliaNetwork));
        
        // 创建provider，确保正确设置了chainId
        const ethersProvider = new ethers.providers.JsonRpcProvider(rpcUrl, arbitrumSepoliaNetwork);
        
        // 创建signer
        let signer = new ethers.Wallet(ownerPrivateKey, ethersProvider);
        console.log(`创建钱包签名者，地址: ${await signer.getAddress()}`);
        
        console.log("创建SimpleAccountAPI，参数:", {
            entryPointAddress,
            factoryAddress,
            owner: `有效的签名者(${await signer.getAddress()})`,
            provider: "有效的JsonRpcProvider"
        });
        
        // 创建SimpleAccountAPI实例
        accountAPI = new SimpleAccountAPI({
            provider: ethersProvider,
            entryPointAddress,
            owner: signer,
            factoryAddress,
            // 设置合理的overheads配置
            overheads: {
                perUserOp: 21000,
                perUserOpWord: 21,
                zeroByte: 4,
                nonZeroByte: 16,
                fixed: 21000,
                bundleSize: 1,
                sigSize: 65
            }
        });
        
        provider = { 
            name: "erc4337Wallet", 
            accountAPI, 
            provider: ethersProvider,
            config
        } as any;
    } else {
        console.log("找到现有的erc4337Wallet提供者");
        accountAPI = (provider as any).accountAPI;
        config = (provider as any).config;
    }
    
    if (!accountAPI) {
        throw new Error("无法初始化钱包API");
    }
    
    // 如果未提供所有者地址，尝试从accountAPI获取
    if (!params.ownerAddress) {
        try {
            params.ownerAddress = await accountAPI.owner.getAddress();
            console.log("从私钥获取所有者地址成功:", params.ownerAddress);
        } catch (error) {
            console.error("从私钥获取所有者地址失败:", error);
            throw new Error("所有者地址不能为空，请提供ownerAddress参数或设置ERC4337_OWNER_PRIVATE_KEY环境变量");
        }
    }
    
    if (!params.ownerAddress) {
        throw new Error("所有者地址不能为空");
    }
    
    try {
        // 获取钱包合约地址（如果已部署会返回现有地址）
        console.log("获取钱包的反事实地址(counterfactual address)...");
        const walletAddress = await accountAPI.getCounterFactualAddress();
        console.log("获取到钱包地址:", walletAddress);
    
        // 检查钱包是否已部署
        const ethersProvider = (provider as any).provider;
        
        // 获取合约代码
        console.log("检查钱包是否已部署...");
        const code = await ethersProvider.getCode(walletAddress);
        const isDeployed = code !== "0x";
        console.log(`钱包地址: ${walletAddress}, 是否已部署: ${isDeployed}`);
        console.log(`合约代码: ${code.length > 10 ? code.substring(0, 10) + '...' : code}`);
    
        let transactionHash;
        if (!isDeployed) {
            try {
                console.log(`创建HttpRpcClient，使用chainId: ${ARBITRUM_SEPOLIA_CHAIN_ID}`);
                
                // 验证provider的chainId
                const network = await ethersProvider.getNetwork();
                console.log(`当前provider的chainId: ${network.chainId}`);
                
                const bundlerClient = new HttpRpcClient(
                    config.rpcUrl,
                    config.entryPointAddress,
                    ARBITRUM_SEPOLIA_CHAIN_ID
                );
                
                // ❶ 创建初始的未签名用户操作（gas字段先设为0）
                console.log("1. 创建初始未签名用户操作...");
                const userOp = await accountAPI.createUnsignedUserOp({
                    target: ethers.constants.AddressZero,
                    data: "0x",
                    value: ethers.BigNumber.from(0)
                });
                
                console.log("初始未签名用户操作:", JSON.stringify(userOp, (key, value) => {
                    if (typeof value === 'bigint') return value.toString();
                    if (value && value.type === 'BigNumber') return value.toString();
                    return value;
                }, 2));
                
                // 确保initCode是已解析的字符串
                let initCode = userOp.initCode || "0x";
                if (typeof initCode !== 'string') {
                    console.log("将initCode转换为字符串");
                    initCode = String(initCode);
                    if (!initCode.startsWith("0x")) {
                        initCode = "0x" + initCode;
                    }
                }
                
                // 准备用户操作对象（使用0或低值作为初始gas估算）
                const initialUserOp = {
                    sender: walletAddress,
                    nonce: userOp.nonce ? ethers.utils.hexlify(await safeToNumber(userOp.nonce, 0)) : "0x00",
                    initCode: initCode,
                    callData: userOp.callData || "0x",
                    callGasLimit: "0x0", // 初始设为0，让bundler估算
                    verificationGasLimit: "0x0", // 初始设为0，让bundler估算
                    preVerificationGas: "0x0", // 初始设为0，让bundler估算
                    maxFeePerGas: userOp.maxFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxFeePerGas, 1700000000)) : ethers.utils.hexlify(1700000000),
                    maxPriorityFeePerGas: userOp.maxPriorityFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxPriorityFeePerGas, 1500000000)) : ethers.utils.hexlify(1500000000),
                    paymasterAndData: userOp.paymasterAndData || "0x",
                    signature: "0x" // 先设为空签名
                };
                
                // ❷ 首次签名，以获取有效签名
                console.log("2. 进行首次签名，获取有效签名...");
                let tempSignature = await accountAPI.signUserOp(initialUserOp);
                console.log("首次签名结果:", tempSignature);
                
                // 处理签名是Promise或对象的情况
                if (tempSignature && typeof tempSignature === 'object') {
                    if (tempSignature.signature && typeof tempSignature.signature.then === 'function') {
                        // Promise中的签名
                        console.log("首次签名返回了Promise中的signature，等待解析...");
                        try {
                            tempSignature = await tempSignature.signature;
                            console.log("签名Promise解析成功:", tempSignature);
                        } catch (error) {
                            console.error("解析签名Promise失败:", error);
                            // 使用假签名
                            tempSignature = "0x" + "11".repeat(65);
                        }
                    } else if (tempSignature.signature && typeof tempSignature.signature === 'string') {
                        // 对象中的签名
                        tempSignature = tempSignature.signature;
                    } else {
                        // 无法识别的签名格式，使用假签名
                        console.warn("无法识别的签名格式，使用默认假签名");
                        tempSignature = "0x" + "11".repeat(65);
                    }
                }
                
                // 确保签名是字符串
                if (typeof tempSignature !== 'string') {
                    console.log("签名不是字符串，转换为字符串");
                    try {
                        tempSignature = String(tempSignature);
                    } catch (error) {
                        console.error("转换签名失败:", error);
                        tempSignature = "0x" + "11".repeat(65);
                    }
                }
                
                // 确保签名格式正确
                if (!tempSignature.startsWith("0x")) {
                    tempSignature = "0x" + tempSignature;
                }
                
                console.log("处理后的签名:", tempSignature);
                
                // 添加签名到用户操作
                const signedUserOpForEstimation = {
                    ...initialUserOp,
                    signature: tempSignature
                };
                
                console.log("带有效签名的用户操作:", JSON.stringify(signedUserOpForEstimation, null, 2));
                
                // ❸ 使用有效签名估算gas
                console.log("3. 使用有效签名估算gas...");
                let gasEstimate;
                try {
                    gasEstimate = await bundlerClient.estimateUserOpGas(signedUserOpForEstimation);
                    console.log("gas估算成功:", gasEstimate);
                    
                    // 确保hex值是有效的偶数长度
                    if (gasEstimate.callGasLimit) {
                        // 移除0x前缀，确保长度为偶数，再添加前缀
                        let hex = gasEstimate.callGasLimit.toString().replace('0x', '');
                        if (hex.length % 2 !== 0) {
                            hex = '0' + hex;
                        }
                        gasEstimate.callGasLimit = '0x' + hex;
                    }
                    
                    if (gasEstimate.verificationGasLimit) {
                        let hex = gasEstimate.verificationGasLimit.toString().replace('0x', '');
                        if (hex.length % 2 !== 0) {
                            hex = '0' + hex;
                        }
                        gasEstimate.verificationGasLimit = '0x' + hex;
                    }
                    
                    if (gasEstimate.preVerificationGas) {
                        let hex = gasEstimate.preVerificationGas.toString().replace('0x', '');
                        if (hex.length % 2 !== 0) {
                            hex = '0' + hex;
                        }
                        gasEstimate.preVerificationGas = '0x' + hex;
                    }
                    
                    console.log("处理后的gas估算值:", gasEstimate);
                } catch (error) {
                    console.log("估算gas失败，使用默认值:", error);
                    
                    // 检查是否是余额不足错误
                    if (error.message && error.message.includes("balance and deposit")) {
                        const balanceMatch = error.message.match(/balance and deposit together is (\d+) but must be at least (\d+)/i);
                        if (balanceMatch && balanceMatch[2]) {
                            const requiredBalance = parseInt(balanceMatch[2]);
                            const requiredEth = ethers.utils.formatEther(requiredBalance.toString());
                            console.log(`错误: 钱包余额不足，需要至少 ${requiredEth} ETH`);
                            throw new Error(`钱包地址余额不足，需要至少 ${requiredEth} ETH，请先向钱包地址 ${walletAddress} 转入足够的ETH`);
                        }
                    }
                    
                    // 使用合理的默认值
                    gasEstimate = {
                        callGasLimit: ethers.BigNumber.from(100000),
                        verificationGasLimit: ethers.BigNumber.from(150000),
                        preVerificationGas: ethers.BigNumber.from(35000)
                    };
                }
                
                // ❹ 使用估算的gas值和calcPreVerificationGas函数计算精确的预验证gas
                console.log("4. 计算精确的预验证gas...");
                const updatedUserOp = {
                    ...signedUserOpForEstimation,
                    callGasLimit: gasEstimate.callGasLimit ? ethers.utils.hexlify(gasEstimate.callGasLimit) : ethers.utils.hexlify(100000),
                    verificationGasLimit: gasEstimate.verificationGasLimit ? ethers.utils.hexlify(gasEstimate.verificationGasLimit) : ethers.utils.hexlify(150000)
                };
                
                // 使用SDK的calcPreVerificationGas函数计算正确的preVerificationGas
                const calculatedPreVerfGas = calcPreVerificationGas(updatedUserOp);
                
                // 确保calculatedPreVerfGas是BigNumber类型
                const preVerGasBN = ethers.BigNumber.isBigNumber(calculatedPreVerfGas) 
                    ? calculatedPreVerfGas 
                    : ethers.BigNumber.from(String(calculatedPreVerfGas));
                
                // 增加20%的安全余量
                const finalPreVerificationGas = preVerGasBN.mul(120).div(100);
                console.log(`计算的preVerificationGas: ${calculatedPreVerfGas}，增加20%后: ${finalPreVerificationGas}`);
                
                updatedUserOp.preVerificationGas = ethers.utils.hexlify(finalPreVerificationGas);
                
                console.log("使用更新后的gas值:", {
                    callGasLimit: updatedUserOp.callGasLimit,
                    callGasLimit_decimal: parseInt(updatedUserOp.callGasLimit, 16),
                    verificationGasLimit: updatedUserOp.verificationGasLimit,
                    verificationGasLimit_decimal: parseInt(updatedUserOp.verificationGasLimit, 16),
                    preVerificationGas: updatedUserOp.preVerificationGas,
                    preVerificationGas_decimal: parseInt(updatedUserOp.preVerificationGas, 16)
                });
                
                // ❺ 使用最终的gas值重新签名
                console.log("5. 使用最终gas值重新签名...");
                let finalSignature = await accountAPI.signUserOp(updatedUserOp);
                console.log("最终签名结果初始形式:", typeof finalSignature, finalSignature);
                
                // 处理签名对象或Promise
                if (finalSignature && typeof finalSignature === 'object') {
                    if (finalSignature.signature && typeof finalSignature.signature.then === 'function') {
                        // Promise中的签名
                        console.log("最终签名返回了Promise中的signature，等待解析...");
                        try {
                            finalSignature = await finalSignature.signature;
                            console.log("最终签名Promise解析成功:", finalSignature);
                        } catch (error) {
                            console.error("解析最终签名Promise失败:", error);
                            throw new Error(`解析最终签名Promise失败: ${error.message}`);
                        }
                    } else if (finalSignature.signature && typeof finalSignature.signature === 'string') {
                        // 对象中的签名
                        finalSignature = finalSignature.signature;
                    }
                }
                
                // 确保签名是字符串
                if (typeof finalSignature !== 'string') {
                    console.error("最终签名不是字符串:", finalSignature);
                    throw new Error(`最终签名格式错误: ${typeof finalSignature}`);
                }
                
                console.log("最终处理后的签名:", finalSignature);
                
                const finalUserOp = {
                    ...updatedUserOp,
                    signature: finalSignature
                };
                
                console.log("最终用户操作:", JSON.stringify(finalUserOp, null, 2));
                
                // ❻ 发送用户操作
                try {
                    console.log("6. 发送用户操作到bundler...");
                    const userOpHash = await bundlerClient.sendUserOpToBundler(finalUserOp);
                    console.log("✅ UserOperation发送成功，哈希:", userOpHash);
                    transactionHash = userOpHash;
                } catch (error) {
                    console.log("发送UserOp失败，错误:", error);
                    
                    // 检查是否是余额不足的错误
                    if (error.message && error.message.includes("balance and deposit")) {
                        const balanceMatch = error.message.match(/balance and deposit together is (\d+) but must be at least (\d+)/i);
                        if (balanceMatch && balanceMatch[2]) {
                            const requiredBalance = parseInt(balanceMatch[2]);
                            const requiredEth = ethers.utils.formatEther(requiredBalance.toString());
                            console.log(`错误: 钱包余额不足，需要至少 ${requiredEth} ETH`);
                            throw new Error(`钱包地址余额不足，需要至少 ${requiredEth} ETH，请先向钱包地址 ${walletAddress} 转入足够的ETH`);
                        }
                    }
                    
                    // 检查是否是preVerificationGas不足的错误
                    if (error.message && error.message.includes("preVerificationGas")) {
                        const preGasMatch = error.message.match(/preVerificationGas is (\d+) but must be at least (\d+)/i);
                        if (preGasMatch && preGasMatch[2]) {
                            const requiredPreGas = parseInt(preGasMatch[2]);
                            console.log(`错误: preVerificationGas不足，需要至少 ${requiredPreGas}`);
                            
                            // 增加更多安全余量重试
                            const newPreGas = Math.ceil(requiredPreGas * 1.3); // 增加30%
                            finalUserOp.preVerificationGas = ethers.utils.hexlify(newPreGas);
                            
                            console.log(`使用更高的preVerificationGas重试: ${newPreGas}`);
                            
                            // 重新签名
                            finalUserOp.signature = await accountAPI.signUserOp(finalUserOp);
                            
                            // 重试发送
                            console.log("重试发送用户操作...");
                            const userOpHash = await bundlerClient.sendUserOpToBundler(finalUserOp);
                            console.log("✅ 重试发送成功，哈希:", userOpHash);
                            transactionHash = userOpHash;
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
            } catch (error) {
                console.error("部署钱包失败:", error);
                
                if (error.stack) {
                    console.error("错误堆栈:", error.stack);
                }
                
                throw new Error(`部署钱包失败: ${error.message}`);
            }
        } else {
            console.log("钱包已部署，无需重新部署");
        }
    
        const response: DeployWalletResponse = {
            walletAddress,
            ownerAddress: params.ownerAddress,
            transactionHash
        };
        
        console.log("部署钱包完成，响应:", response);
    
        // 构建响应内容
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

// 实现验证函数
const validateDeployWallet = async (runtime, message, state) => {
    return true;
};

// 创建完全兼容的Action对象
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