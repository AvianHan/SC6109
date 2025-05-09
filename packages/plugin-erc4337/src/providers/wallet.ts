import { type Provider, ProviderCategory, type ProviderDefinition } from "../types";
import { ethers } from "ethers";
import { ERC4337EthersProvider, SimpleAccountAPI } from "@account-abstraction/sdk";
import { HttpRpcClient } from "@account-abstraction/sdk";
import { type ERC4337WalletConfig } from "../types";
import { type IAgentRuntime, type Memory, type State } from "@elizaos/core";
import { Provider as EthersProvider } from '@ethersproject/providers';

// Erc4337钱包提供者实例接口
interface Erc4337WalletProviderInstance {
    name: string;
    accountAPI: SimpleAccountAPI;
    provider: ethers.providers.JsonRpcProvider;
    config: ERC4337WalletConfig;
}

// 专用于初始化的Provider定义
export const erc4337WalletProviderDefinition: ProviderDefinition = {
    name: "erc4337Wallet",
    category: ProviderCategory.WALLET,
    init: (runtime): Erc4337WalletProviderInstance => {
        const { settings } = runtime;
        
        // 获取配置参数
        const rpcUrl = settings.ERC4337_RPC_URL;
        const entryPointAddress = settings.ERC4337_ENTRYPOINT_ADDRESS;
        const factoryAddress = settings.ERC4337_FACTORY_ADDRESS;
        const ownerPrivateKey = settings.ERC4337_OWNER_PRIVATE_KEY;
        
        if (!rpcUrl || !entryPointAddress || !factoryAddress) {
            throw new Error("缺少ERC4337配置参数");
        }
        
        // 创建配置对象
        const config: ERC4337WalletConfig = {
            rpcUrl,
            entryPointAddress,
            factoryAddress,
            ownerPrivateKey
        };
        
        // 确保使用正确的Arbitrum Sepolia网络
        const arbitrumSepoliaNetwork = {
            name: "arbitrum-sepolia",
            chainId: 421614
        };
        
        // 创建provider时确保正确设置了chainId
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl, arbitrumSepoliaNetwork);
        
        // 无法直接修改network属性，使用monkey patch方法覆盖getNetwork方法
        const originalGetNetwork = provider.getNetwork;
        provider.getNetwork = async function() {
            // 始终返回Arbitrum Sepolia网络信息
            return Promise.resolve(arbitrumSepoliaNetwork);
        };
        
        // 手动验证chainId是否正确
        provider.detectNetwork().then(network => {
            if (network.chainId !== 421614) {
                console.warn(`Provider网络检测返回chainId ${network.chainId}，但期望的是421614，部分功能可能异常`);
            } else {
                console.log("Provider网络chainId验证成功: 421614");
            }
        }).catch(error => {
            console.error("网络检测失败:", error);
        });
        
        const accountAPI = createAccountAPI(config, provider) as SimpleAccountAPI;
        
        return {
            name: "erc4337Wallet",
            accountAPI,
            provider,
            config
        };
    }
};

// 兼容Core的Provider接口
export const erc4337WalletProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        try {
            // 查找已创建的provider实例
            const providerInstance = runtime.providers.find(
                p => p && typeof p === 'object' && 'name' in p && p.name === "erc4337Wallet"
            ) as unknown as Erc4337WalletProviderInstance;
            
            if (!providerInstance) {
                return null;
            }
            
            // 获取钱包信息
            const { accountAPI, provider } = providerInstance;
            if (!accountAPI) {
                return null;
            }
            
            // 获取钱包地址
            const walletAddress = await accountAPI.getCounterFactualAddress();
            
            // 检查钱包是否已部署
            const code = await provider.getCode(walletAddress);
            const isDeployed = code !== "0x";
            
            // 获取所有者地址
            const ownerAddress = await accountAPI.owner.getAddress();
            
            // 返回钱包信息
            return `ERC-4337钱包信息:\n地址: ${walletAddress}\n所有者: ${ownerAddress}\n状态: ${isDeployed ? '已部署' : '未部署'}`;
        } catch (error) {
            console.error("获取ERC-4337钱包信息失败:", error);
            return null;
        }
    }
};

function createAccountAPI(config: ERC4337WalletConfig, provider: ethers.providers.JsonRpcProvider): SimpleAccountAPI {
    const { entryPointAddress, factoryAddress, ownerPrivateKey } = config;
    
    let signer: ethers.Signer;
    if (ownerPrivateKey) {
        signer = new ethers.Wallet(ownerPrivateKey, provider);
    } else {
        throw new Error("需要提供钱包私钥");
    }
    
    // 确保provider已设置正确的chainId（Arbitrum Sepolia）
    const network = provider.network || { chainId: 421614, name: "arbitrum-sepolia" };
    // 如果provider没有正确的chainId，设置它
    if (network.chainId !== 421614) {
        console.warn(`Provider网络chainId (${network.chainId}) 与 Arbitrum Sepolia (421614) 不匹配，将使用421614`);
        // 不直接修改provider.network，而是在其他地方确保使用正确的chainId
    }
    
    // 这里必须强制类型转换，SDK期望旧版ethers v5的Provider类型
    // 但我们使用的是ethers v5的Provider却有其他兼容性问题
    const compatProvider = {
        getNetwork: provider.getNetwork.bind(provider),
        getSigner: () => signer,
        getCode: provider.getCode.bind(provider),
        getGasPrice: async () => provider.getFeeData().then(data => data.gasPrice!),
        // 添加对gas的处理及其他必要方法
        estimateGas: provider.estimateGas.bind(provider),
        call: async (transaction: any, blockTag?: any) => {
            // 极大提高gas限制，确保有足够gas执行合约调用
            console.log("调用前的transaction:", JSON.stringify(transaction));
            
            // 如果没有提供gasLimit或提供的值太小，则设置足够高的值
            if (!transaction.gasLimit || ethers.BigNumber.from(transaction.gasLimit).lt(50000)) {
                transaction.gasLimit = ethers.BigNumber.from(1000000); // 设置为100万，远高于需要的22256
            }
            
            // 如果交易没有gas相关字段，添加它们
            if (!transaction.gasPrice) {
                const feeData = await provider.getFeeData();
                transaction.gasPrice = feeData.gasPrice || ethers.utils.parseUnits("10", "gwei");
            }
            
            console.log("调用后的transaction:", JSON.stringify({
                ...transaction,
                gasLimit: transaction.gasLimit?.toString(),
                gasPrice: transaction.gasPrice?.toString()
            }));
            
            return provider.call(transaction, blockTag);
        },
        // 其他必要的Provider方法
        getBlock: provider.getBlock.bind(provider),
        getBlockNumber: provider.getBlockNumber.bind(provider),
        getTransaction: provider.getTransaction.bind(provider),
        getTransactionReceipt: provider.getTransactionReceipt.bind(provider),
        on: () => { return { removeAllListeners: () => {} } },
        removeListener: () => compatProvider
    } as unknown as EthersProvider;
    
    // 获取SimpleAccountAPI实例
    const accountAPI = new SimpleAccountAPI({
        provider: compatProvider,
        entryPointAddress,
        owner: signer as any, // 强制类型转换，因为SDK期望ethers v5的Signer
        factoryAddress
    });
    
    // 重写getCounterFactualAddress方法以确保提供足够的gas
    const originalGetCounterFactualAddress = accountAPI.getCounterFactualAddress.bind(accountAPI);
    accountAPI.getCounterFactualAddress = async function() {
        try {
            // 尝试使用原始方法
            return await originalGetCounterFactualAddress();
        } catch (error) {
            console.log("原始getCounterFactualAddress方法失败，尝试使用自定义方法:", error);
            
            // 如果失败，使用自定义方法
            // 获取entryPoint合约实例
            const entryPointContract = (this as any).entryPointView;
            
            // 确保已经准备好initCode
            if (!(this as any)._initCode) {
                await (this as any)._getInitCode();
            }
            
            // 在调用时明确提供高gas限制
            const sender = await entryPointContract.callStatic.getSenderAddress(
                (this as any)._initCode,
                {
                    from: await (this as any).owner.getAddress(),
                    gasLimit: ethers.BigNumber.from(1000000) // 100万gas，足够进行部署模拟
                }
            );
            
            console.log("使用自定义方法获取地址成功:", sender);
            return sender;
        }
    };
    
    return accountAPI;
}