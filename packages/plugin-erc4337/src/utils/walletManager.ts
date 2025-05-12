import { ethers } from "ethers";
import { SimpleAccountAPI } from "@account-abstraction/sdk";
import { Provider as EthersProvider } from '@ethersproject/providers';
import { HttpRpcClient } from "@account-abstraction/sdk";
import { calcPreVerificationGas } from "@account-abstraction/sdk";
import { IAgentRuntime } from "@elizaos/core";
import safeToNumber from "./safeToNumbers";
import evenGas from "./evenGas";
import { ERC4337WalletConfig } from "../types";

// 设置正确的Arbitrum Sepolia chainId
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

/**
 * ERC-4337钱包管理器
 * 
 * 负责创建和管理ERC-4337钱包的核心功能类，包括：
 * - 初始化provider和accountAPI
 * - 获取钱包地址和部署状态
 * - 执行钱包部署操作
 * 
 * 该类被provider和action共享使用，确保状态一致性
 */
export class Erc4337WalletManager {
    public accountAPI: SimpleAccountAPI;
    public ethersProvider: ethers.providers.JsonRpcProvider;
    public config: ERC4337WalletConfig;

    /**
     * 创建ERC-4337钱包管理器实例
     * @param config ERC-4337配置对象
     * @param ethersProvider ethers提供者
     */
    constructor(config: ERC4337WalletConfig, ethersProvider: ethers.providers.JsonRpcProvider) {
        this.config = config;
        this.ethersProvider = ethersProvider;
        
        this.accountAPI = this.createAccountAPI();
    }

    /**
     * 获取钱包反事实地址
     * @returns 钱包地址
     */
    async getCounterFactualAddress(): Promise<string> {
        return await this.accountAPI.getCounterFactualAddress();
    }

    /**
     * 检查钱包是否已部署
     * @returns 部署状态(true/false)
     */
    async isDeployed(): Promise<boolean> {
        const walletAddress = await this.getCounterFactualAddress();
        const code = await this.ethersProvider.getCode(walletAddress);
        return code !== "0x";
    }

    /**
     * 获取所有者地址
     * @returns 所有者地址
     */
    async getOwnerAddress(): Promise<string> {
        // 从privateKey创建钱包获取地址
        if (this.config.ownerPrivateKey) {
            const wallet = new ethers.Wallet(this.config.ownerPrivateKey);
            return wallet.address;
        } else {
            throw new Error("需要提供钱包私钥");
        }
    }

    /**
     * 部署钱包
     * @param index 可选的钱包索引
     * @returns 交易哈希或undefined(如已部署)
     */
    async deployWallet(index?: string): Promise<string | undefined> {
        const walletAddress = await this.getCounterFactualAddress();
        const isDeployed = await this.isDeployed();
        
        if (isDeployed) {
            console.log("钱包已部署，无需重新部署");
            return undefined;
        }

        // 创建Bundler客户端
        const bundlerClient = new HttpRpcClient(
            this.config.rpcUrl,
            this.config.entryPointAddress,
            ARBITRUM_SEPOLIA_CHAIN_ID
        );

        // 1. 创建初始未签名用户操作
        const userOp = await this.accountAPI.createUnsignedUserOp({
            target: ethers.constants.AddressZero,
            data: "0x",
            value: ethers.BigNumber.from(0)
        });
        
        let initCode = userOp.initCode || "0x";
        
        // 2. 构建初始用户操作
        const initialUserOp = {
            sender: walletAddress,
            nonce: userOp.nonce ? ethers.utils.hexlify(await safeToNumber(userOp.nonce, 0)) : "0x00",
            initCode: initCode,
            callData: userOp.callData || "0x",
            callGasLimit: "0x0", 
            verificationGasLimit: "0x0", 
            preVerificationGas: "0x0",
            maxFeePerGas: userOp.maxFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxFeePerGas, 1700000000)) : ethers.utils.hexlify(1700000000),
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas ? ethers.utils.hexlify(await safeToNumber(userOp.maxPriorityFeePerGas, 1500000000)) : ethers.utils.hexlify(1500000000),
            paymasterAndData: userOp.paymasterAndData || "0x",
            signature: "0x"
        };
        
        // 3. 获取有效签名
        let tempSignature = await this.accountAPI.signUserOp(initialUserOp as any);
        
        // 处理签名可能是对象的情况
        if (tempSignature && typeof tempSignature === 'object') {
            // Promise中的签名
            console.log("首次签名返回了Promise中的signature，等待解析...");
            try {
                tempSignature = await (tempSignature as any).signature;
                console.log("签名Promise解析成功:", tempSignature);
            } catch (error) {
                console.error("解析签名Promise失败:", error);
            }
        }
        
        // 4. 创建用于估算gas的带签名用户操作
        const signedUserOpForEstimation = {
            ...initialUserOp,
            signature: tempSignature
        };
        
        // 5. 估算gas
        let gasEstimate;
        try {
            gasEstimate = await bundlerClient.estimateUserOpGas(signedUserOpForEstimation as any);
            gasEstimate = evenGas(gasEstimate);
        } catch (error) {
            console.log("估算gas失败", error);
        }
        
        // 6. 更新用户操作为最终估算的gas值
        const updatedUserOp = {
            ...signedUserOpForEstimation,
            callGasLimit: gasEstimate.callGasLimit ? ethers.utils.hexlify(gasEstimate.callGasLimit) : ethers.utils.hexlify(100000),
            verificationGasLimit: gasEstimate.verificationGasLimit ? ethers.utils.hexlify(gasEstimate.verificationGasLimit) : ethers.utils.hexlify(150000)
        };
        
        // 7. 计算精确的预验证gas
        const calculatedPreVerfGas = calcPreVerificationGas(updatedUserOp as any);
        const preVerGasBN = ethers.BigNumber.isBigNumber(calculatedPreVerfGas) 
            ? calculatedPreVerfGas 
            : ethers.BigNumber.from(String(calculatedPreVerfGas));
        
        // 增加10%安全余量
        const finalPreVerificationGas = preVerGasBN.mul(110).div(100);
        updatedUserOp.preVerificationGas = ethers.utils.hexlify(finalPreVerificationGas);
        
        // 8. 最终签名
        let finalSignature = await this.accountAPI.signUserOp(updatedUserOp as any);
        
        // 处理签名可能是对象的情况
        if (finalSignature && typeof finalSignature === 'object') {
            if (finalSignature.signature && typeof (finalSignature.signature as any).then === 'function') {
                try {
                    finalSignature = await (finalSignature as any).signature;
                } catch (error) {
                    throw new Error(`解析最终签名Promise失败: ${error.message}`);
                }
            } else if (finalSignature.signature && typeof finalSignature.signature === 'string') {
                finalSignature = (finalSignature as any).signature;
            }
        }
        
        // 9. 创建最终用户操作
        const finalUserOp = {
            ...updatedUserOp,
            signature: finalSignature
        };
        
        // 10. 发送用户操作到Bundler
        try {
            const userOpHash = await bundlerClient.sendUserOpToBundler(finalUserOp as any);
            console.log("✅ UserOperation发送成功，哈希:", userOpHash);
            return userOpHash;
        } catch (error) {
            if (error.message && error.message.includes("balance and deposit")) {
                const balanceMatch = error.message.match(/balance and deposit together is (\d+) but must be at least (\d+)/i);
                if (balanceMatch && balanceMatch[2]) {
                    const requiredBalance = parseInt(balanceMatch[2]);
                    const requiredEth = ethers.utils.formatEther(requiredBalance.toString());
                    throw new Error(`钱包地址余额不足，需要至少 ${requiredEth} ETH，请先向钱包地址 ${walletAddress} 转入足够的ETH`);
                }
            }
            throw error;
        }
    }

    /**
     * 创建SimpleAccountAPI实例
     * @returns SimpleAccountAPI实例
     */
    private createAccountAPI(): SimpleAccountAPI {
        const { entryPointAddress, factoryAddress, ownerPrivateKey } = this.config;
        
        if (!ownerPrivateKey) {
            throw new Error("需要提供钱包私钥");
        }
        
        console.log("创建签名者...");
        const signer = new ethers.Wallet(ownerPrivateKey, this.ethersProvider);
        
        // 确保provider已设置正确的chainId
        const network = this.ethersProvider.network || { chainId: ARBITRUM_SEPOLIA_CHAIN_ID, name: "arbitrum-sepolia" };
        if (network.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
            console.warn(`Provider网络chainId (${network.chainId}) 与 Arbitrum Sepolia (${ARBITRUM_SEPOLIA_CHAIN_ID}) 不匹配，将使用${ARBITRUM_SEPOLIA_CHAIN_ID}`);
        }
        
        console.log(`使用签名者地址: ${signer.address}, EntryPoint: ${entryPointAddress}, Factory: ${factoryAddress}`);
        
        // 创建兼容的provider包装器
        const compatProvider = this.ethersProvider;
        
        // 创建SimpleAccountAPI实例
        try {
            console.log("创建SimpleAccountAPI实例...");
            return new SimpleAccountAPI({
                provider: compatProvider,
                entryPointAddress,
                owner: signer,
                index: 1,
                factoryAddress,
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
        } catch (error) {
            console.error("创建SimpleAccountAPI失败:", error);
            throw error;
        }
    }
}

/**
 * 初始化ERC-4337钱包管理器
 * 
 * 从runtime设置或环境变量中获取配置，并创建钱包管理器实例
 * 该函数被provider和action共享使用
 * 
 * @param runtime AgentRuntime实例
 * @returns Erc4337WalletManager实例
 */
export async function initErc4337WalletManager(runtime: IAgentRuntime): Promise<Erc4337WalletManager> {
    console.log("initErc4337WalletManager开始...");
    
    // 优先从runtime设置中获取配置
    let rpcUrl = runtime.getSetting("ERC4337_RPC_URL");
    let entryPointAddress = runtime.getSetting("ERC4337_ENTRYPOINT_ADDRESS");
    let factoryAddress = runtime.getSetting("ERC4337_FACTORY_ADDRESS");
    let ownerPrivateKey = runtime.getSetting("ERC4337_OWNER_PRIVATE_KEY");
    
    // 如果runtime设置中没有，则从环境变量中获取
    if (!rpcUrl) rpcUrl = process.env.ERC4337_RPC_URL;
    if (!entryPointAddress) entryPointAddress = process.env.ERC4337_ENTRYPOINT_ADDRESS;
    if (!factoryAddress) factoryAddress = process.env.ERC4337_FACTORY_ADDRESS;
    if (!ownerPrivateKey) ownerPrivateKey = process.env.ERC4337_OWNER_PRIVATE_KEY;
    
    console.log("配置检查:");
    console.log(`- RPC URL: ${rpcUrl ? '已设置' : '未设置'}`);
    console.log(`- EntryPoint地址: ${entryPointAddress ? '已设置' : '未设置'}`);
    console.log(`- Factory地址: ${factoryAddress ? '已设置' : '未设置'}`);
    console.log(`- 私钥: ${ownerPrivateKey ? '已设置(隐藏)' : '未设置'}`);
    
    if (!rpcUrl || !entryPointAddress || !factoryAddress || !ownerPrivateKey) {
        throw new Error("缺少ERC4337配置参数，请检查环境变量或runtime设置");
    }
    
    // 确保私钥格式正确(如果不是以0x开头，添加0x前缀)
    if (ownerPrivateKey && !ownerPrivateKey.startsWith('0x')) {
        ownerPrivateKey = `0x${ownerPrivateKey}`;
        console.log("已为私钥添加0x前缀");
    }
    
    // 创建配置对象
    const config: ERC4337WalletConfig = {
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
    
    console.log(`创建JsonRpcProvider，使用URL: ${maskUrl(rpcUrl)}，网络: ${JSON.stringify(arbitrumSepoliaNetwork)}`);
    
    try {
        // 创建provider，确保正确设置了chainId
        const ethersProvider = new ethers.providers.JsonRpcProvider(rpcUrl, arbitrumSepoliaNetwork);
        
        // 等待provider连接完成
        const network = await ethersProvider.getNetwork();
        console.log(`连接到网络: ${network.name} (chainId: ${network.chainId})`);
        
        // 创建并返回钱包管理器实例
        return new Erc4337WalletManager(config, ethersProvider);
    } catch (error) {
        console.error("创建provider失败:", error);
        throw new Error(`创建provider失败: ${error.message}`);
    }
}

/**
 * 屏蔽URL中可能的敏感信息，用于日志打印
 */
function maskUrl(url: string): string {
    if (!url) return '';
    try {
        const urlObj = new URL(url);
        // 如果URL包含用户名和密码，进行屏蔽
        if (urlObj.username || urlObj.password) {
            return url.replace(/\/\/[^@]*@/, '//***:***@');
        }
        // 如果URL包含API密钥等查询参数，屏蔽它们
        if (urlObj.search && (urlObj.search.includes('key=') || urlObj.search.includes('apikey='))) {
            return `${urlObj.origin}${urlObj.pathname}/***masked-params***`;
        }
        return url;
    } catch (e) {
        // 如果无法解析URL，返回部分屏蔽的字符串
        return url.substring(0, 10) + '***';
    }
}